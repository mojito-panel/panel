import { createServerFn } from '@tanstack/react-start';
import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import { Node, Recipe, Server, User, Allocation } from '~/db/entities';
import { adminNodesList } from '~/lists/nodes';
import { nodeAllocationsList } from '~/lists/allocations';
import { adminRecipesList, type AdminRecipeRow } from '~/lists/recipes';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import { requireUser, requirePanelPermission, HttpError } from '../session';
import { withOrmContext } from '../middleware';
import { logActivity } from '../activity';
import { orm } from '../orm';
import { decryptSecret } from '../crypto';
import { agentHealth, agentGetStats } from '../agent/client';
import { isPublicAddress } from '../assert-public-host';
import { signHealthToken } from '../jwt';
import {
  createNode,
  requireNode,
  deleteNode,
  agentVersionOf,
  resetNodeToken,
  findFreeAllocations,
  createAllocations,
  deleteAllocation,
  deleteAllocations,
  assignAllocation,
  revokeAllocation,
} from '../nodes';
import {
  recipeErrorMessage,
  assertValidRecipeJson,
  fetchRecipeJsonFromUrl,
  normalizeRecipeUrl,
  upsertRecipe,
  createRecipe,
  updateRecipe,
  requireRecipe,
  deleteRecipe,
  storedRecipeVariables,
  type RecipeSourceStamp,
} from '../recipes';
import { canonicalRecipeHash } from '../registry-entries';
import { computeRecipeStatus, type RecipeSourceStatus } from '~/lib/recipe-source';
import { normalizeStoredRecipe } from '~/lib/stored-recipe';
import {
  createNodeSchema,
  deleteNodeSchema,
  updateNodeSchema,
  nodeIdSchema,
  nodeFqdnSchema,
  createAllocationsSchema,
  allocationIdSchema,
  assignAllocationSchema,
  deleteAllocationsSchema,
  parsePortsSpec,
  PORTS_SPEC_MESSAGE,
  isHttpsScheme,
} from '~/validators/node';
import {
  importRecipesSchema,
  importEggSchema,
  getRecipeSchema,
  createRecipeSchema,
  updateRecipeSchema,
  deleteRecipeSchema,
} from '~/validators/recipe';
import { importEgg } from '~/contract/egg-import';
import { type RecipeVariable } from '~/contract';

// ─── Nodes (admin) ─────────────────────────────────────────────────────────────

/**
 * Node list — the unpaginated picker helper (node selection when creating
 * a server, /admin/servers/new). Gated on `panel.nodes` read: every caller
 * lives in the admin area, and the node list (FQDNs, ports) is admin-only
 * data. The token is NEVER exposed here.
 */
export const listNodesFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    await requirePanelPermission({ 'panel.nodes': ['read'] });
    const nodes = await orm.em.find(Node, {});
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

/**
 * Admin node list (/admin/nodes) — filter/sort/pagination run in the database
 * (`adminNodesList`). Distinct from `listNodesFn` above, which stays the
 * unpaginated picker helper (node selection when creating a server).
 */
export const listAdminNodesFn = createServerFn({ method: 'POST' })
  .validator(adminNodesList.querySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.nodes': ['read'] });
    const em = orm.em;

    const { rows, rowCount } = await runListQuery(
      listQueryBuilder(em, Node, adminNodesList),
      adminNodesList.spec,
      data,
    );

    return {
      rowCount,
      rows: rows.map((node) => ({
        id: node.id,
        name: node.name,
        fqdn: node.fqdn,
        scheme: node.scheme,
        publicPort: node.publicPort,
        status: node.status,
        createdAt: node.createdAt,
      })),
    };
  });

export const createNodeFn = createServerFn({ method: 'POST' })
  .validator(createNodeSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.nodes':['create']});
    const { id, agentToken } = await createNode(data);

    // Audit trail before the row goes any further.
    await logActivity({ event: 'node:create', description: `Node « ${data.name} » créé (${data.fqdn})`, actor: { id: user.id, name: user.name, email: user.email }, properties: { nodeId: id } });

    // The token is returned ONCE — the admin copies the generated shard.yml
    // (below) onto the node and it will never be replayable in clear again.
    const node = await requireNode(id);
    return {
      id: node.id,
      name: node.name,
      fqdn: node.fqdn,
      agentPort: node.agentPort,
      publicPort: node.publicPort,
      sftpPort: node.sftpPort,
      scheme: node.scheme,
      agentToken,
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
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.nodes': ['read'] });
    try {
      const result = await lookup(data.fqdn);
      // The resolved address runs through the same SSRF policy as the
      // panel's own outbound fetches: a node "reachable" through a
      // loopback/link-local record is not an answer the panel will use.
      return { ip: isPublicAddress(result.address) ? result.address : null };
    } catch {
      return { ip: null };
    }
  });

export const deleteNodeFn = createServerFn({ method: 'POST' })
  .validator(deleteNodeSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.nodes':['delete']});
    const node = await requireNode(data.nodeId);
    await deleteNode(node);
    await logActivity({ event: 'node:delete', description: `Node « ${node.name} » supprimé`, actor: { id: user.id, name: user.name, email: user.email }, properties: { nodeId: node.id } });
    return { deleted: true };
  });

/**
 * Node detail (Pelican EditNode/ViewNode equivalent): stored fields and
 * server count — DB ONLY, always fast. The LIVE agent status/version is a
 * separate best-effort query (`getNodeHealthFn`, polled by the page), so
 * an offline agent never blocks the page. The token is NEVER returned
 * (encrypted at rest, shown once at creation/reset).
 */
export const getNodeFn = createServerFn({ method: 'GET' })
  .validator(nodeIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['read']});
    const node = await requireNode(data.nodeId);
    const serverCount = await orm.em.count(Server, { nodeId: node.id });

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
      // Panel URL for the (re)generated agent configuration.
      panelUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
    };
  });

/**
 * Live node health — one agent ping (short timeout), syncing
 * status/lastSeenAt in DB like the dashboard's ping. The version is null
 * when the agent is unreachable (never an error — the badge shows
 * "Inconnu" then). Polled by the node page at a regular interval.
 */
export const getNodeHealthFn = createServerFn({ method: 'GET' })
  .validator(nodeIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['read']});
    const node = await requireNode(data.nodeId);

    const agentVersion = await agentVersionOf(node);
    if (agentVersion) {
      node.status = 'online';
      node.lastSeenAt = new Date();
    } else {
      node.status = 'offline';
    }
    await orm.em.flush();

    return {
      status: node.status as 'online' | 'offline',
      lastSeenAt: node.lastSeenAt,
      agentVersion,
    };
  });

/**
 * Basic settings update (Pelican "basic_settings" tab equivalent).
 */
export const updateNodeFn = createServerFn({ method: 'POST' })
  .validator(updateNodeSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.nodes':['update']});
    const node = await requireNode(data.nodeId);

    node.name = data.name;
    node.fqdn = data.fqdn;
    node.agentPort = data.agentPort;
    node.publicPort = data.publicPort;
    node.scheme = data.scheme;
    node.sftpPort = data.sftpPort;
    await orm.em.flush();
    await logActivity({ event: 'node:update', description: `Node « ${node.name} » mis à jour`, actor: { id: user.id, name: user.name, email: user.email }, properties: { nodeId: node.id } });

    return { updated: true };
  });

/**
 * Token reset (Pelican "reset token" action equivalent): generates a NEW
 * token, stores it encrypted and returns it ONCE — the admin copies the
 * regenerated shard.yml and updates the agent's config file.
 */
export const resetNodeTokenFn = createServerFn({ method: 'POST' })
  .validator(nodeIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.nodes':['update']});
    const node = await requireNode(data.nodeId);
    const agentToken = await resetNodeToken(node);
    await logActivity({ event: 'node:reset_token', description: `Token du node « ${node.name} » régénéré`, actor: { id: user.id, name: user.name, email: user.email }, properties: { nodeId: node.id } });

    return {
      agentToken,
      panelUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
    };
  });

// ─── Allocations (admin node pool — Pelican NodeResource "Allocations") ──────

/**
 * Free allocations of a node — the unpaginated picker of the server
 * creation form (admin-only: /admin/servers/new). Gated on `panel.nodes`
 * read like the node list it belongs to.
 */
export const listFreeNodeAllocationsFn = createServerFn({ method: 'GET' })
  .validator(nodeIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.nodes': ['read'] });
    const free = await findFreeAllocations(data.nodeId);
    return free.map((allocation) => ({
      id: allocation.id,
      ip: allocation.ip,
      port: allocation.port,
      alias: allocation.alias,
    }));
  });

/**
 * Allocations of a node with their assigned server (null = free) — the admin
 * node pool table (/admin/nodes/$nodeId). Filter/sort/pagination run in the
 * database (`nodeAllocationsList`); the node id is a route param, applied to
 * the query builder BEFORE `runListQuery` (never a search param). The
 * unpaginated `listFreeNodeAllocationsFn` above stays the picker helper.
 */
export const listNodeAllocationsFn = createServerFn({ method: 'POST' })
  .validator(nodeAllocationsList.querySchema.and(nodeIdSchema))
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['read']});
    const em = orm.em;

    const qb = listQueryBuilder(em, Allocation, nodeAllocationsList);
    qb.andWhere({ nodeId: data.nodeId });

    const { rows, rowCount } = await runListQuery(qb, nodeAllocationsList.spec, data);

    // Server names of the current page only (the query stays bounded by pageSize).
    const serverIds = [
      ...new Set(rows.map((row) => row.serverId).filter((id): id is string => id !== null)),
    ];
    const servers =
      serverIds.length > 0 ? await em.find(Server, { id: { $in: serverIds } }) : [];
    const names = new Map(servers.map((server) => [server.id, server.name]));

    return {
      rowCount,
      rows: rows.map((allocation) => {
        const serverId = allocation.serverId ?? null;
        return {
          id: allocation.id,
          ip: allocation.ip ?? '0.0.0.0',
          port: allocation.port,
          alias: allocation.alias ?? null,
          serverId,
          serverName: serverId === null ? null : names.get(serverId) ?? null,
          primary: allocation.primary ?? false,
        };
      }),
    };
  });

/**
 * Creates allocations on a node from an IP + ports spec ("25565" or
 * "25570-25575, 25599"). Ports already allocated on that IP are skipped —
 * the report tells the admin what was created and what was left alone.
 */
export const createNodeAllocationsFn = createServerFn({ method: 'POST' })
  .validator(createAllocationsSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['create']});
    await requireNode(data.nodeId);

    const ports = parsePortsSpec(data.ports);
    if (!ports) throw new HttpError(422, PORTS_SPEC_MESSAGE);

    const alias = data.alias.trim() === '' ? null : data.alias.trim();
    return createAllocations(data.nodeId, data.ip, ports, alias);
  });

/** Deletes a FREE allocation — an assigned one must be revoked first. */
export const deleteAllocationFn = createServerFn({ method: 'POST' })
  .validator(allocationIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['delete']});
    const allocation = await orm.em.findOne(Allocation, { id: data.allocationId });
    if (!allocation) throw new HttpError(404, 'Allocation introuvable');
    await deleteAllocation(allocation);
    return { deleted: true };
  });

/**
 * Deletes FREE allocations in bulk (the node pool checkboxes). Assigned ones
 * are skipped and reported — they must be revoked first, one bulk action
 * never mixes the two. Ids that no longer exist simply match nothing.
 */
export const deleteAllocationsFn = createServerFn({ method: 'POST' })
  .validator(deleteAllocationsSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.nodes':['delete']});
    const allocations = await orm.em.find(Allocation, { id: { $in: data.allocationIds } });
    return deleteAllocations(allocations);
  });

/**
 * Assigns a free allocation to a server of the same node (Pelican "assign"
 * action). A server without any primary promotes the newcomer and syncs the
 * agent cache — otherwise the primary is left untouched.
 */
export const assignAllocationFn = createServerFn({ method: 'POST' })
  .validator(assignAllocationSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.nodes':['update']});
    const em = orm.em;

    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation) throw new HttpError(404, 'Allocation introuvable');
    const server = await em.findOne(Server, { id: data.serverId });
    if (!server) throw new HttpError(404, 'Serveur introuvable');

    await assignAllocation(allocation, server);
    await logActivity({ event: 'allocation:assign', description: `Allocation ${allocation.ip}:${allocation.port} affectée à « ${server.name} »`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { allocationId: allocation.id } });
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
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.nodes':['update']});
    const allocation = await orm.em.findOne(Allocation, { id: data.allocationId });
    if (!allocation || allocation.serverId === null) {
      throw new HttpError(404, 'Allocation libre introuvable');
    }
    const serverId = allocation.serverId;

    await revokeAllocation(allocation);
    await logActivity({ event: 'allocation:revoke', description: `Allocation ${allocation.ip}:${allocation.port} révoquée (retour au pool libre)`, actor: { id: user.id, name: user.name, email: user.email }, properties: { allocationId: allocation.id, serverId } });
    return { id: allocation.id };
  });

// ─── Recipes ───────────────────────────────────────────────────────────────────

/**
 * Admin recipe list (/admin/recipes) — filter/sort/pagination run in the
 * database (`adminRecipesList`).
 */
export const listRecipesFn = createServerFn({ method: 'POST' })
  .validator(adminRecipesList.querySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requireUser();
    const em = orm.em;

    const { rows, rowCount } = await runListQuery(
      listQueryBuilder(em, Recipe, adminRecipesList),
      adminRecipesList.spec,
      data,
    );

    return {
      rowCount,
      rows: rows.map((recipe): AdminRecipeRow => {
        /** Recipe type ('runtime' badges the list row, null = app recipe). */
        const type = typeof recipe.json.type === 'string' ? recipe.json.type : null;
        /** Provenance — the stored stamp, or the recipe's own update_url. */
        const sourceUrl =
          recipe.sourceUrl ??
          (typeof recipe.json.update_url === 'string' ? recipe.json.update_url : null);
        const storedSha = canonicalRecipeHash(recipe.json);
        const sourceStatus: RecipeSourceStatus = computeRecipeStatus({
          sourceUrl,
          sourceSha: recipe.sourceSha ?? null,
          remoteSha: recipe.remoteSha ?? null,
          remoteCheckedAt: recipe.remoteCheckedAt ?? null,
          storedSha,
        });

        return {
          id: recipe.id,
          slug: recipe.slug,
          name: recipe.name,
          type,
          variableCount: storedRecipeVariables(recipe.json).length,
          sourceUrl,
          sourceStatus,
          createdAt: recipe.createdAt,
          updatedAt: recipe.updatedAt,
        };
      }),
    };
  });

/**
 * Picker options: the FULL recipe set with their variable definitions —
 * used by the server creation form. Unpaginated, unlike `listRecipesFn`.
 */
export const listRecipeOptionsFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    await requireUser();
    const recipes = await orm.em.find(Recipe, {});
    return recipes.map(
      (recipe): {
        id: string;
        slug: string;
        name: string;
        variables: RecipeVariable[];
      } => ({
        id: recipe.id,
        slug: recipe.slug,
        name: recipe.name,
        variables: storedRecipeVariables(recipe.json),
      }),
    );
  });

/**
 * Batch recipe import: raw JSONs (textarea/files) + URLs.
 * Each source is processed independently — failures do not cancel
 * successes (per-recipe report, like Pelican egg import).
 */
export const importRecipesFn = createServerFn({ method: 'POST' })
  .validator(importRecipesSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.recipes':['create']});

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
        const recipeJson = assertValidRecipeJson(raw);
        const saved = await upsertRecipe(recipeJson, recipeSourceStamp(recipeJson, source.url));
        imported.push({ ...saved, source: label });
      } catch (err) {
        failed.push({ source: label, error: recipeErrorMessage(err) });
      }
    }

    await logActivity({ event: 'recipe:import', description: `${imported.length} recette(s) importée(s), ${failed.length} échec(s)`, actor: { id: user.id, name: user.name, email: user.email }, properties: { imported: imported.map((r) => r.slug), failed: failed.map((f) => f.source) } });

    return { imported, failed };
  });

/**
 * Provenance of an import (~/lib/recipe-source): a URL import records that
 * URL (normalized — github blob → raw) as the recipe's source; a paste/file
 * import falls back to the recipe's own `update_url` when it carries one.
 * Either way the imported content is the baseline of the update checks.
 */
function recipeSourceStamp(
  recipeJson: { update_url?: string },
  url?: string,
): RecipeSourceStamp | undefined {
  if (url) {
    return { url: normalizeRecipeUrl(url), sha: canonicalRecipeHash(recipeJson) };
  }
  if (recipeJson.update_url) {
    return { url: normalizeRecipeUrl(recipeJson.update_url), sha: canonicalRecipeHash(recipeJson) };
  }
  return undefined;
}

/**
 * PTDL_v2 (Pelican egg) import: maps the egg to a recipe v3 and upserts
 * it. The mapping warnings (install scripts ignored, unsupported parsers…)
 * travel back to the UI — the admin completes the install section with
 * the declarative actions.
 */
export const importEggFn = createServerFn({ method: 'POST' })
  .validator(importEggSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.recipes': ['create'] });

    let parsed: unknown;
    try {
      parsed = JSON.parse(data.json);
    } catch {
      throw new HttpError(400, 'JSON invalide');
    }

    let recipeJson;
    let warnings: string[];
    try {
      ({ recipe: recipeJson, warnings } = importEgg(parsed));
    } catch (err) {
      throw new HttpError(400, `Œuf invalide : ${recipeErrorMessage(err)}`);
    }

    // The mapped egg keeps its update_url — it becomes the recipe's source.
    const saved = await upsertRecipe(recipeJson, recipeSourceStamp(recipeJson));
    await logActivity({ event: 'recipe:import_egg', description: `Œuf importé : recette « ${saved.slug} »`, actor: { id: user.id, name: user.name, email: user.email }, properties: { warnings: warnings.length } });
    return { ...saved, warnings };
  });

export const getRecipeFn = createServerFn({ method: 'POST' })
  .validator(getRecipeSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({'panel.recipes':['read']});
    const recipe = await requireRecipe(data.recipeId);

    return {
      id: recipe.id,
      slug: recipe.slug,
      name: recipe.name,
      schemaVersion: recipe.schemaVersion,
      /** Pretty-printed raw JSON — used for editing AND export. */
      json: JSON.stringify(normalizeStoredRecipe(recipe.json), null, 2),
    };
  });

/**
 * Creates a new recipe from the editor UI (JSON payload validated against
 * the contract). Unlike an import (upsert), a slug clash is REJECTED —
 * the editor shows the conflict instead of silently overwriting.
 */
export const createRecipeFn = createServerFn({ method: 'POST' })
  .validator(createRecipeSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.recipes':['create']});
    const recipe = await createRecipe(assertValidRecipeJson(data.json));
    await logActivity({ event: 'recipe:create', description: `Recette « ${recipe.slug} » créée`, actor: { id: user.id, name: user.name, email: user.email }, properties: { recipeId: recipe.id } });
    return recipe;
  });

/**
 * Edits an existing recipe: the full JSON is revalidated against the contract schema.
 * The slug (id) can change — uniqueness is rechecked.
 */
export const updateRecipeFn = createServerFn({ method: 'POST' })
  .validator(updateRecipeSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.recipes':['update']});
    const recipe = await updateRecipe(data.recipeId, assertValidRecipeJson(data.json));
    await logActivity({ event: 'recipe:update', description: `Recette « ${recipe.slug} » modifiée`, actor: { id: user.id, name: user.name, email: user.email }, properties: { recipeId: recipe.id } });
    return recipe;
  });

export const deleteRecipeFn = createServerFn({ method: 'POST' })
  .validator(deleteRecipeSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.recipes':['delete']});
    const recipe = await requireRecipe(data.recipeId);
    await deleteRecipe(recipe.id);
    await logActivity({ event: 'recipe:delete', description: `Recette « ${recipe.name} » supprimée`, actor: { id: user.id, name: user.name, email: user.email }, properties: { recipeId: recipe.id } });
    return { deleted: true };
  });

// ─── Overview (admin dashboard) ───────────────────────────────────────────────

/** Timeout of one agent healthcheck — a dashboard load must stay snappy. */
const AGENT_PING_TIMEOUT_MS = 2500;

/**
 * Applies ping outcomes onto the node rows and persists them — shared by
 * the overview poll and the health page (both ping, then stamp the rows).
 */
async function applyPingResults(
  nodes: Parameters<typeof agentHealth>[0][],
  pings: PromiseSettledResult<unknown>[],
): Promise<void> {
  const now = new Date();
  nodes.forEach((node, index) => {
    if (pings[index].status === 'fulfilled') {
      node.status = 'online';
      node.lastSeenAt = now;
    } else {
      node.status = 'offline';
    }
  });
  if (nodes.length > 0) await orm.em.flush();
}

/** Pings every node in parallel and stamps the outcomes on the rows. */
async function pingNodes(nodes: Parameters<typeof agentHealth>[0][]) {
  const pings = await Promise.allSettled(
    nodes.map((node) => agentHealth(node, { signal: AbortSignal.timeout(AGENT_PING_TIMEOUT_MS) })),
  );
  await applyPingResults(nodes, pings);
  return pings;
}

/**
 * Admin dashboard data: global counters and the 5 most recent servers —
 * DB ONLY, always fast (counts via `em.count`, recent rows via a bounded
 * `limit` query; only the referenced recipes/owners of those rows are
 * loaded). The LIVE node health pings are a separate best-effort query
 * (`getAdminOverviewHealthFn`, polled by the page), so offline agents
 * never block the dashboard.
 */
export const getAdminOverviewFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    await requirePanelPermission({'panel.overview':['read']});
    const em = orm.em;

    const [serverCount, runningCount, installingCount, nodeCount, userCount, recipeCount] =
      await Promise.all([
        em.count(Server),
        em.count(Server, { status: 'running' }),
        em.count(Server, { status: 'installing' }),
        em.count(Node),
        em.count(User),
        em.count(Recipe),
      ]);

    const [nodes, recentRows] = await Promise.all([
      em.find(Node, {}),
      em.find(Server, {}, { orderBy: { createdAt: 'desc' }, limit: 5 }),
    ]);

    // Per-node server count — one bounded count per node (nodes are few).
    const counts = await Promise.all(
      nodes.map((node) => em.count(Server, { nodeId: node.id })),
    );

    // Display rows of the recent 5 only (queries stay bounded).
    const recipeIds = [...new Set(recentRows.map((server) => server.recipeId))];
    const ownerIds = [...new Set(recentRows.map((server) => server.ownerId))];
    const [recentRecipes, recentOwners] = await Promise.all([
      recipeIds.length > 0 ? em.find(Recipe, { id: { $in: recipeIds } }) : [],
      ownerIds.length > 0 ? em.find(User, { id: { $in: ownerIds } }) : [],
    ]);
    const recipeNames = new Map(recentRecipes.map((recipe) => [recipe.id, recipe.name]));
    const ownerEmails = new Map(recentOwners.map((owner) => [owner.id, owner.email]));

    // DB status is served immediately; the health poll below refreshes it.
    const nodeDtos = nodes.map((node, index) => ({
      id: node.id,
      name: node.name,
      fqdn: node.fqdn,
      scheme: node.scheme,
      publicPort: node.publicPort,
      status: node.status,
      lastSeenAt: node.lastSeenAt,
      serverCount: counts[index],
    }));

    const recentServers = recentRows.map((server) => ({
      id: server.id,
      name: server.name,
      status: server.status,
      nodeName: nodes.find((n) => n.id === server.nodeId)?.name ?? '—',
      recipeName: recipeNames.get(server.recipeId) ?? '—',
      ownerEmail: ownerEmails.get(server.ownerId) ?? '—',
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

/**
 * Live node health for the dashboard — parallel agent pings (short
 * timeout), syncing status/lastSeenAt in DB. Per node: the live status
 * and the agent version (null when unreachable). Polled by the page.
 */
export const getAdminOverviewHealthFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    await requirePanelPermission({'panel.overview':['read']});
    const nodes = await orm.em.find(Node, {});
    const pings = await pingNodes(nodes);
    return nodes.map((node, index) => ({
      id: node.id,
      status: node.status as 'online' | 'offline',
      lastSeenAt: node.lastSeenAt,
      agentVersion:
        pings[index].status === 'fulfilled' ? (pings[index].value.version ?? null) : null,
    }));
  });

// ─── Health (admin dashboard) ────────────────────────────────────────────────

/**
 * Node health list — per node: measured latency (round-trip of the REST
 * /stats snapshot) + the snapshot itself. The live graphs are NOT here: the
 * browser opens a DIRECT WS to each agent (see /admin/health) and the panel
 * stays out of the loop (Pelican PR #2558 semantics).
 */
export const getHealthNodesFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    await requirePanelPermission({'panel.overview':['read']});
    const nodes = await orm.em.find(Node, {});

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
    await applyPingResults(nodes, pings);

    return nodes.map((node, index) => ({
      id: node.id,
      name: node.name,
      fqdn: node.fqdn,
      scheme: node.scheme,
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
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({'panel.overview':['read']});
    const node = await requireNode(data.nodeId);

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
