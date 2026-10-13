import { createServerFn } from '@tanstack/react-start';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { ZodError } from 'zod';
import type { EntityManager } from '@mikro-orm/core';
import { initOrm } from '~/db';
import { Node, Recipe, Server, User, Allocation } from '~/db/entities';
import { nanoid } from '~/lib/nanoid';
import { parseRecipe, DEFAULT_SFTP_PORT, type Recipe as RecipeDefinition } from '~/contract';
import { requireUser, requirePanelPermission, HttpError } from '../session';
import { encryptSecret, decryptSecret } from '../crypto';
import { agentHealth, agentGetStats, agentUpdateAllocation, AgentError } from '../agent/client';
import { signHealthToken } from '../jwt';
import {
  createNodeSchema,
  deleteNodeSchema,
  updateNodeSchema,
  nodeIdSchema,
  nodeFqdnSchema,
  createAllocationsSchema,
  allocationIdSchema,
  assignAllocationSchema,
  parsePortsSpec,
  PORTS_SPEC_MESSAGE,
  isHttpsScheme,
} from '~/validators/node';
import {
  importRecipesSchema,
  getRecipeSchema,
  createRecipeSchema,
  updateRecipeSchema,
  deleteRecipeSchema,
} from '~/validators/recipe';

// ─── Nodes (admin) ─────────────────────────────────────────────────────────────

/**
 * Node list — accessible to any signed-in user (node
 * selection when creating a server). The token is NEVER exposed here.
 */
export const listNodesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser();
  const orm = await initOrm();
  const em = orm.em.fork();
  const nodes = await em.find(Node, {});
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    fqdn: node.fqdn,
    scheme: node.scheme,
    agentPort: node.agentPort,
    publicPort: node.publicPort,
    status: node.status,
    lastSeenAt: node.lastSeenAt,
  }));
});

export const createNodeFn = createServerFn({ method: 'POST' })
  .validator(createNodeSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['create']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const node = em.create(Node, {
      id: nanoid(),
      name: data.name,
      fqdn: data.fqdn,
      scheme: data.scheme,
      agentPort: data.agentPort,
      publicPort: data.publicPort,
      sftpPort: data.sftpPort ?? DEFAULT_SFTP_PORT,
      // Encrypted at rest — the token doubles as the console-JWT signing key
      agentToken: encryptSecret(token),
      lastSeenAt: null,
      status: 'unknown',
      createdAt: now,
      updatedAt: now,
    });
    em.persist(node);
    await em.flush();

    // The token is returned ONCE — the admin copies the generated shard.yml
    // (below) onto the node and it will never be replayable in clear again.
    return {
      id: node.id,
      name: node.name,
      fqdn: node.fqdn,
      agentPort: node.agentPort,
      publicPort: node.publicPort,
      sftpPort: node.sftpPort,
      scheme: node.scheme,
      agentToken: token,
      // Panel URL injected into the generated agent config (shard.yml).
      panelUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
    };
  });

/**
 * Pelican-style live FQDN check: resolves the hostname server-side (a browser
 * cannot do DNS lookups) so the create form can show "valid: <ip>" or
 * "unreachable". Never throws — an unresolvable name IS the answer.
 */
export const resolveNodeFqdnFn = createServerFn({ method: 'GET' })
  .validator(nodeFqdnSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.nodes': ['read'] });
    try {
      const result = await lookup(data.fqdn);
      return { ip: result.address };
    } catch {
      return { ip: null };
    }
  });

export const deleteNodeFn = createServerFn({ method: 'POST' })
  .validator(deleteNodeSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['delete']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: data.nodeId });
    if (!node) throw new HttpError(404, 'Node introuvable');

    // Refuse deletion while servers are still installed on it
    const servers = await em.find(Server, { nodeId: node.id });
    if (servers.length > 0) {
      throw new HttpError(409, `${servers.length} serveur(s) encore installé(s) sur ce node`);
    }

    em.remove(node);
    await em.flush();
    return { deleted: true };
  });

/**
 * Node detail (Pelican EditNode/ViewNode equivalent): stored fields,
 * server count, and a LIVE agent version ping (non-fatal — the agent may
 * be down, that is what the status column is for). The token is NEVER
 * returned (encrypted at rest, shown once at creation/reset).
 */
export const getNodeFn = createServerFn({ method: 'GET' })
  .validator(nodeIdSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['read']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: data.nodeId });
    if (!node) throw new HttpError(404, 'Node introuvable');

    const serverCount = await em.count(Server, { nodeId: node.id });

    // Live agent version — best effort, never blocks the page.
    let agentVersion: string | null = null;
    try {
      const health = await agentHealth(node);
      agentVersion = health.version;
    } catch {
      agentVersion = null;
    }

    return {
      id: node.id,
      name: node.name,
      fqdn: node.fqdn,
      scheme: node.scheme,
      agentPort: node.agentPort,
      publicPort: node.publicPort,
      sftpPort: node.sftpPort,
      status: node.status,
      lastSeenAt: node.lastSeenAt,
      createdAt: node.createdAt,
      serverCount,
      agentVersion,
      // Panel URL for the (re)generated agent configuration.
      panelUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
    };
  });

/**
 * Basic settings update (Pelican "basic_settings" tab equivalent).
 */
export const updateNodeFn = createServerFn({ method: 'POST' })
  .validator(updateNodeSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['update']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: data.nodeId });
    if (!node) throw new HttpError(404, 'Node introuvable');

    node.name = data.name;
    node.fqdn = data.fqdn;
    node.agentPort = data.agentPort;
    node.publicPort = data.publicPort;
    node.scheme = data.scheme;
    node.sftpPort = data.sftpPort;
    await em.flush();

    return { updated: true };
  });

/**
 * Token reset (Pelican "reset token" action equivalent): generates a NEW
 * token, stores it encrypted and returns it ONCE — the admin copies the
 * regenerated shard.yml and updates the agent's config file.
 */
export const resetNodeTokenFn = createServerFn({ method: 'POST' })
  .validator(nodeIdSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['update']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: data.nodeId });
    if (!node) throw new HttpError(404, 'Node introuvable');

    const token = randomBytes(32).toString('hex');
    node.agentToken = encryptSecret(token);
    await em.flush();

    return {
      agentToken: token,
      panelUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
    };
  });

// ─── Allocations (admin node pool — Pelican NodeResource "Allocations") ──────

/**
 * Free allocations of a node — available to any signed-in user (the server
 * creation form picks from this pool, like Pelican's deployment form).
 */
export const listFreeNodeAllocationsFn = createServerFn({ method: 'GET' })
  .validator(nodeIdSchema)
  .handler(async ({ data }) => {
    await requireUser();
    const orm = await initOrm();
    const em = orm.em.fork();
    const free = await em.find(Allocation, { nodeId: data.nodeId, serverId: null });
    return free
      .sort((a, b) => a.port - b.port)
      .map((allocation) => ({
        id: allocation.id,
        ip: allocation.ip,
        port: allocation.port,
        alias: allocation.alias,
      }));
  });

/**
 * All allocations of a node with their assigned server (null = free),
 * plus the servers installed on the node (the "assign" picker needs them).
 */
export const listNodeAllocationsFn = createServerFn({ method: 'GET' })
  .validator(nodeIdSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['read']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const [allocations, servers] = await Promise.all([
      em.find(Allocation, { nodeId: data.nodeId }),
      em.find(Server, { nodeId: data.nodeId }),
    ]);

    return allocations
      .sort((a, b) => a.port - b.port)
      .map((allocation) => ({
        id: allocation.id,
        ip: allocation.ip,
        port: allocation.port,
        alias: allocation.alias,
        primary: allocation.primary,
        serverId: allocation.serverId,
        serverName:
          servers.find((s) => s.id === allocation.serverId)?.name ?? null,
      }));
  });

/**
 * Creates allocations on a node from an IP + ports spec ("25565" or
 * "25570-25575, 25599"). Ports already allocated on that IP are skipped —
 * the report tells the admin what was created and what was left alone.
 */
export const createNodeAllocationsFn = createServerFn({ method: 'POST' })
  .validator(createAllocationsSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['create']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: data.nodeId });
    if (!node) throw new HttpError(404, 'Node introuvable');

    const ports = parsePortsSpec(data.ports);
    if (!ports) throw new HttpError(422, PORTS_SPEC_MESSAGE);

    const existing = await em.find(Allocation, { nodeId: data.nodeId, ip: data.ip });
    const takenPorts = new Set(existing.map((a) => a.port));

    const now = new Date();
    const alias = data.alias.trim() === '' ? null : data.alias.trim();
    let created = 0;
    for (const port of ports) {
      if (takenPorts.has(port)) continue;
      em.persist(
        em.create(Allocation, {
          id: nanoid(),
          nodeId: data.nodeId,
          serverId: null,
          ip: data.ip,
          port,
          alias,
          primary: false,
          createdAt: now,
        }),
      );
      created++;
    }
    await em.flush();

    return {
      created,
      skipped: ports.length - created,
    };
  });

/** Deletes a FREE allocation — an assigned one must be revoked first. */
export const deleteAllocationFn = createServerFn({ method: 'POST' })
  .validator(allocationIdSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['delete']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation) throw new HttpError(404, 'Allocation introuvable');
    if (allocation.serverId !== null) {
      throw new HttpError(409, 'Cette allocation est affectée à un serveur — révoque-la d’abord');
    }

    em.remove(allocation);
    await em.flush();
    return { deleted: true };
  });

/**
 * Assigns a free allocation to a server of the same node (Pelican "assign"
 * action). A server without any primary promotes the newcomer and syncs
 * the agent cache — otherwise the primary is left untouched.
 */
export const assignAllocationFn = createServerFn({ method: 'POST' })
  .validator(assignAllocationSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['update']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation) throw new HttpError(404, 'Allocation introuvable');
    if (allocation.serverId !== null) {
      throw new HttpError(409, 'Cette allocation est déjà affectée à un serveur');
    }

    const server = await em.findOne(Server, { id: data.serverId });
    if (!server) throw new HttpError(404, 'Serveur introuvable');
    if (server.nodeId !== allocation.nodeId) {
      throw new HttpError(422, 'Ce serveur n’est pas installé sur le node de l’allocation');
    }

    const hadPrimary = (await em.find(Allocation, { serverId: server.id })).some(
      (a) => a.primary,
    );
    allocation.serverId = server.id;
    allocation.primary = !hadPrimary;
    await em.flush();

    if (!hadPrimary) {
      const node = await em.findOne(Node, { id: server.nodeId });
      if (node) {
        try {
          await agentUpdateAllocation(node, server.id, {
            port: allocation.port,
            ip: allocation.ip,
          });
        } catch (err) {
          if (err instanceof AgentError && err.statusCode === 404) {
            // tolerated — agent out of sync, DB remains the source of truth
          } else {
            if (err instanceof AgentError) {
              throw new HttpError(502, `Synchronisation du node échouée : ${err.message}`);
            }
            throw err;
          }
        }
      }
    }

    return { id: allocation.id };
  });

/**
 * Revokes an assigned allocation — it returns to the node's free pool
 * (Pelican "revoke" action). Revoking the primary promotes the first other
 * allocation of the server and syncs the agent; refusing when it is the
 * last one keeps every server reachable through a primary allocation.
 */
export const revokeAllocationFn = createServerFn({ method: 'POST' })
  .validator(allocationIdSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['update']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation || allocation.serverId === null) {
      throw new HttpError(404, 'Allocation libre introuvable');
    }

    const assigned = await em.find(Allocation, { serverId: allocation.serverId });
    const others = assigned.filter((a) => a.id !== allocation.id).sort((a, b) => a.port - b.port);

    if (allocation.primary && others.length === 0) {
      throw new HttpError(409, 'Un serveur doit conserver au moins une allocation principale');
    }

    const wasPrimary = allocation.primary;
    const server = await em.findOne(Server, { id: allocation.serverId });
    allocation.serverId = null;
    allocation.primary = false;
    let promoted: { port: number; ip: string } | null = null;
    if (wasPrimary && others.length > 0) {
      others[0].primary = true;
      promoted = { port: others[0].port, ip: others[0].ip };
    }
    await em.flush();

    if (wasPrimary && promoted && server) {
      const node = await em.findOne(Node, { id: server.nodeId });
      if (node) {
        try {
          await agentUpdateAllocation(node, server.id, promoted);
        } catch (err) {
          if (err instanceof AgentError && err.statusCode === 404) {
            // tolerated — agent out of sync, DB remains the source of truth
          } else {
            if (err instanceof AgentError) {
              throw new HttpError(502, `Synchronisation du node échouée : ${err.message}`);
            }
            throw err;
          }
        }
      }
    }

    return { id: allocation.id };
  });

// ─── Recipes ───────────────────────────────────────────────────────────────────

/** Parses raw JSON and validates it against the contract's v2 schema. */
function parseRecipeJson(raw: string): RecipeDefinition {
  return parseRecipe(JSON.parse(raw));
}

/** Readable error message (ZodError → list of fields in error). */
function recipeErrorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join('.') || 'recipe'} : ${i.message}`).join(' · ');
  }
  return (err as Error).message;
}

/**
 * Converts a github.com/…/blob/… URL to raw.githubusercontent.com/…/raw/…
 * (catalog GitHub URLs point to the web page, not the raw file).
 */
function normalizeRecipeUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
    return `https://raw.githubusercontent.com${parsed.pathname.replace('/blob/', '/raw/')}${parsed.search}`;
  }
  return url;
}

/** Downloads a recipe's JSON from a URL (.json extension required). */
async function fetchRecipeJsonFromUrl(url: string): Promise<string> {
  const normalized = normalizeRecipeUrl(url);
  if (!new URL(normalized).pathname.toLowerCase().endsWith('.json')) {
    throw new HttpError(400, 'Seules les URLs pointant vers un .json sont supportées');
  }
  let res: Response;
  try {
    res = await fetch(normalized, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new HttpError(502, `Téléchargement impossible : ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new HttpError(502, `Téléchargement échoué (HTTP ${res.status})`);
  }
  const body = await res.text();
  if (body.length > 2_000_000) {
    throw new HttpError(413, 'Fichier trop volumineux (> 2 Mo)');
  }
  return body;
}

/**
 * Creates the recipe or updates the one with the same slug (upsert —
 * a re-import updates the definition, like Pelican eggs).
 */
async function upsertRecipe(
  em: EntityManager,
  recipeJson: RecipeDefinition,
): Promise<{ slug: string; name: string; created: boolean }> {
  const existing = await em.findOne(Recipe, { slug: recipeJson.id });
  const now = new Date();

  if (existing) {
    existing.name = recipeJson.name;
    existing.schemaVersion = recipeJson.schemaVersion;
    existing.json = recipeJson;
    existing.updatedAt = now;
    await em.flush();
    return { slug: existing.slug, name: existing.name, created: false };
  }

  const recipe = em.create(Recipe, {
    id: nanoid(),
    slug: recipeJson.id,
    name: recipeJson.name,
    schemaVersion: recipeJson.schemaVersion,
    json: recipeJson,
    createdAt: now,
    updatedAt: now,
  });
  em.persist(recipe);
  await em.flush();
  return { slug: recipe.slug, name: recipe.name, created: true };
}

export const listRecipesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser();
  const orm = await initOrm();
  const em = orm.em.fork();
  const recipes = await em.find(Recipe, {});
  return recipes.map((recipe) => {
    const def = recipe.json as RecipeDefinition;
    return {
      id: recipe.id,
      slug: recipe.slug,
      name: recipe.name,
      schemaVersion: recipe.schemaVersion,
      /** Variable definitions (auto-generated form at creation). */
      variables: def.variables ?? [],
      /** Update URL (re-import) if defined by the recipe. */
      updateUrl: def.updateUrl ?? null,
      createdAt: recipe.createdAt,
    };
  });
});

/**
 * Batch recipe import: raw JSONs (textarea/files) + URLs.
 * Each source is processed independently — failures do not cancel
 * successes (per-recipe report, like Pelican egg import).
 */
export const importRecipesFn = createServerFn({ method: 'POST' })
  .validator(importRecipesSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.recipes':['create']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const imported: Array<{ slug: string; name: string; created: boolean; source: string }> = [];
    const failed: Array<{ source: string; error: string }> = [];

    const sources: Array<{ raw?: string; url?: string }> = [
      ...(data.jsons ?? []).map((raw) => ({ raw })),
      ...(data.urls ?? []).map((url) => ({ url })),
    ];

    for (const [index, source] of sources.entries()) {
      const label = source.url ?? `JSON #${index + 1}`;
      try {
        const raw = source.url ? await fetchRecipeJsonFromUrl(source.url) : source.raw;
        if (!raw) throw new HttpError(400, 'JSON vide');
        const recipeJson = parseRecipeJson(raw);
        const saved = await upsertRecipe(em, recipeJson);
        imported.push({ ...saved, source: label });
      } catch (err) {
        failed.push({ source: label, error: recipeErrorMessage(err) });
      }
    }

    return { imported, failed };
  });

export const getRecipeFn = createServerFn({ method: 'POST' })
  .validator(getRecipeSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.recipes':['read']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const recipe = await em.findOne(Recipe, { id: data.recipeId });
    if (!recipe) throw new HttpError(404, 'Recette introuvable');

    return {
      id: recipe.id,
      slug: recipe.slug,
      name: recipe.name,
      schemaVersion: recipe.schemaVersion,
      /** Pretty-printed raw JSON — used for editing AND export. */
      json: JSON.stringify(recipe.json, null, 2),
    };
  });

/**
 * Creates a new recipe from the editor UI (JSON payload validated against
 * the v2 contract). Unlike an import (upsert), a slug clash is REJECTED —
 * the editor shows the conflict instead of silently overwriting.
 */
export const createRecipeFn = createServerFn({ method: 'POST' })
  .validator(createRecipeSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.recipes':['create']});
    const orm = await initOrm();
    const em = orm.em.fork();

    let recipeJson: RecipeDefinition;
    try {
      recipeJson = parseRecipeJson(data.json);
    } catch (err) {
      throw new HttpError(400, `Recipe invalide : ${recipeErrorMessage(err)}`);
    }

    const clash = await em.findOne(Recipe, { slug: recipeJson.id });
    if (clash) {
      throw new HttpError(409, `Une recette avec le slug « ${recipeJson.id} » existe déjà`);
    }

    const now = new Date();
    const recipe = em.create(Recipe, {
      id: nanoid(),
      slug: recipeJson.id,
      name: recipeJson.name,
      schemaVersion: recipeJson.schemaVersion,
      json: recipeJson,
      createdAt: now,
      updatedAt: now,
    });
    em.persist(recipe);
    await em.flush();

    return { id: recipe.id, slug: recipe.slug, name: recipe.name };
  });

/**
 * Edits an existing recipe: the full JSON is revalidated against the v2 schema.
 * The slug (id) can change — uniqueness is rechecked.
 */
export const updateRecipeFn = createServerFn({ method: 'POST' })
  .validator(updateRecipeSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.recipes':['update']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const recipe = await em.findOne(Recipe, { id: data.recipeId });
    if (!recipe) throw new HttpError(404, 'Recette introuvable');

    let recipeJson: RecipeDefinition;
    try {
      recipeJson = parseRecipeJson(data.json);
    } catch (err) {
      throw new HttpError(400, `Recipe invalide : ${recipeErrorMessage(err)}`);
    }

    if (recipeJson.id !== recipe.slug) {
      const clash = await em.findOne(Recipe, { slug: recipeJson.id });
      if (clash) {
        throw new HttpError(409, `Une recette avec le slug « ${recipeJson.id} » existe déjà`);
      }
      recipe.slug = recipeJson.id;
    }

    recipe.name = recipeJson.name;
    recipe.schemaVersion = recipeJson.schemaVersion;
    recipe.json = recipeJson;
    recipe.updatedAt = new Date();
    await em.flush();

    return { id: recipe.id, slug: recipe.slug, name: recipe.name };
  });

export const deleteRecipeFn = createServerFn({ method: 'POST' })
  .validator(deleteRecipeSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.recipes':['delete']});
    const orm = await initOrm();
    const em = orm.em.fork();

    const recipe = await em.findOne(Recipe, { id: data.recipeId });
    if (!recipe) throw new HttpError(404, 'Recette introuvable');

    const servers = await em.find(Server, { recipeId: recipe.id });
    if (servers.length > 0) {
      throw new HttpError(409, `${servers.length} serveur(s) utilisent cette recette`);
    }

    em.remove(recipe);
    await em.flush();
    return { deleted: true };
  });

// ─── Overview (admin dashboard) ───────────────────────────────────────────────

/** Timeout of one agent healthcheck — a dashboard load must stay snappy. */
const AGENT_PING_TIMEOUT_MS = 2500;

/**
 * Admin dashboard data: global counters, node health (live agent ping of
 * the public /health route — also refreshes status/lastSeenAt in DB) and
 * the 5 most recent servers.
 */
export const getAdminOverviewFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePanelPermission({'panel.overview':['read']});
  const orm = await initOrm();
  const em = orm.em.fork();

  const [serverCount, nodeCount, userCount, recipeCount] = await Promise.all([
    em.count(Server),
    em.count(Node),
    em.count(User),
    em.count(Recipe),
  ]);

  const [servers, nodes, recipes, users] = await Promise.all([
    em.find(Server, {}),
    em.find(Node, {}),
    em.find(Recipe, {}),
    em.find(User, {}),
  ]);

  const runningCount = servers.filter((s) => s.status === 'running').length;
  const installingCount = servers.filter((s) => s.status === 'installing').length;

  // Live agent healthcheck (parallel, short timeout — an offline node
  // must not slow the whole dashboard down)
  const pings = await Promise.allSettled(
    nodes.map((node) => agentHealth(node, { signal: AbortSignal.timeout(AGENT_PING_TIMEOUT_MS) })),
  );
  const now = new Date();
  nodes.forEach((node, index) => {
    const ping = pings[index];
    if (ping.status === 'fulfilled') {
      node.status = 'online';
      node.lastSeenAt = now;
    } else {
      node.status = 'offline';
    }
  });
  if (nodes.length > 0) await em.flush();

  const nodeDtos = nodes.map((node, index) => ({
    id: node.id,
    name: node.name,
    fqdn: node.fqdn,
    publicPort: node.publicPort,
    status: node.status,
    lastSeenAt: node.lastSeenAt,
    agentVersion: pings[index].status === 'fulfilled' ? (pings[index].value.version ?? null) : null,
    serverCount: servers.filter((s) => s.nodeId === node.id).length,
  }));

  const recentServers = [...servers]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map((server) => ({
      id: server.id,
      name: server.name,
      status: server.status,
      nodeName: nodes.find((n) => n.id === server.nodeId)?.name ?? '—',
      recipeName: recipes.find((p) => p.id === server.recipeId)?.name ?? '—',
      ownerEmail: users.find((u) => u.id === server.ownerId)?.email ?? '—',
      createdAt: server.createdAt,
    }));

  return {
    counts: {
      servers: serverCount,
      running: runningCount,
      installing: installingCount,
      nodes: nodeCount,
      users: userCount,
      recipes: recipeCount,
    },
    nodes: nodeDtos,
    recentServers,
  };
});

// ─── Health (admin dashboard) ────────────────────────────────────────────────

/**
 * Node health list — per node: measured latency (round-trip of the REST
 * /stats snapshot) + the snapshot itself. The live graphs are NOT here: the
 * browser opens a DIRECT WS to each agent (see /admin/health) and the panel
 * stays out of the loop (Pelican PR #2558 semantics).
 */
export const getHealthNodesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePanelPermission({'panel.overview':['read']});
  const orm = await initOrm();
  const em = orm.em.fork();
  const nodes = await em.find(Node, {});

  // Parallel ping — an offline node must not slow the page down
  const pings = await Promise.allSettled(
    nodes.map(async (node) => {
      const startedAt = Date.now();
      const stats = await agentGetStats(node, {
        signal: AbortSignal.timeout(AGENT_PING_TIMEOUT_MS),
      });
      return { stats, latencyMs: Date.now() - startedAt };
    }),
  );

  const now = new Date();
  nodes.forEach((node, index) => {
    const ping = pings[index];
    if (ping.status === 'fulfilled') {
      node.status = 'online';
      node.lastSeenAt = now;
    } else {
      node.status = 'offline';
    }
  });
  if (nodes.length > 0) await em.flush();

  return nodes.map((node, index) => ({
    id: node.id,
    name: node.name,
    fqdn: node.fqdn,
    publicPort: node.publicPort,
    // Just set above by the ping — typed for the health page's DTO
    status: node.status as 'online' | 'offline' | 'unknown',
    lastSeenAt: node.lastSeenAt ?? null,
    latencyMs: pings[index].status === 'fulfilled' ? pings[index].value.latencyMs : null,
    snapshot: pings[index].status === 'fulfilled' ? pings[index].value.stats : null,
  }));
});

/**
 * Health WS token (browser ↔ agent direct socket) — same Pelican-style
 * flow as the console token: short-lived JWT signed with the node's OWN
 * agent token, refreshed in-place by re-sending `auth` before expiry.
 */
export const createNodeHealthTokenFn = createServerFn({ method: 'POST' })
  .validator(deleteNodeSchema) // { nodeId } — same shape as the other node fns
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.overview':['read']});
    const orm = await initOrm();
    const em = orm.em.fork();
    const node = await em.findOne(Node, { id: data.nodeId });
    if (!node) throw new HttpError(404, 'Node introuvable');

    const { token, expiresAt } = signHealthToken(
      { userId: user.id },
      decryptSecret(node.agentToken),
    );

    return {
      token,
      expiresAt,
      wsUrl: `${isHttpsScheme(node.scheme) ? 'wss' : 'ws'}://${node.fqdn}:${node.publicPort}/health/ws`,
    };
  });
