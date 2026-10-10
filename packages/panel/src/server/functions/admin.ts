import { createServerFn } from '@tanstack/react-start';
import { randomBytes, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { EntityManager } from '@mikro-orm/core';
import { initOrm } from '~/db';
import { Node, Plugin, Server, User } from '~/db/entities';
import { parsePlugin, type Plugin as PluginDefinition } from '@mojito/contract';
import { requireUser, requireAdmin, HttpError } from '../session';
import { encryptSecret, decryptSecret } from '../crypto';
import { agentHealth, agentGetStats } from '../agent/client';
import { signHealthToken } from '../jwt';
import { createNodeSchema, deleteNodeSchema } from '~/validators/node';
import {
  importPluginsSchema,
  getPluginSchema,
  createPluginSchema,
  updatePluginSchema,
  deletePluginSchema,
} from '~/validators/plugin';

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
    agentPort: node.agentPort,
    status: node.status,
    lastSeenAt: node.lastSeenAt,
  }));
});

export const createNodeFn = createServerFn({ method: 'POST' })
  .validator(createNodeSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    const orm = await initOrm();
    const em = orm.em.fork();

    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const node = em.create(Node, {
      id: randomUUID(),
      name: data.name,
      fqdn: data.fqdn,
      agentPort: data.agentPort,
      // Encrypted at rest — the token doubles as the console-JWT signing key
      agentToken: encryptSecret(token),
      lastSeenAt: null,
      status: 'unknown',
      createdAt: now,
      updatedAt: now,
    });
    em.persist(node);
    await em.flush();

    // The token is returned ONCE — the admin copies it into the agent
    // config (AGENT_TOKEN) and it will never be replayable in clear again.
    return {
      id: node.id,
      name: node.name,
      fqdn: node.fqdn,
      agentPort: node.agentPort,
      agentToken: token,
    };
  });

export const deleteNodeFn = createServerFn({ method: 'POST' })
  .validator(deleteNodeSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
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

// ─── Plugins ───────────────────────────────────────────────────────────────────

/** Parses raw JSON and validates it against the contract's v2 schema. */
function parsePluginJson(raw: string): PluginDefinition {
  return parsePlugin(JSON.parse(raw));
}

/** Readable error message (ZodError → list of fields in error). */
function pluginErrorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join('.') || 'plugin'} : ${i.message}`).join(' · ');
  }
  return (err as Error).message;
}

/**
 * Converts a github.com/…/blob/… URL to raw.githubusercontent.com/…/raw/…
 * (catalog GitHub URLs point to the web page, not the raw file).
 */
function normalizePluginUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
    return `https://raw.githubusercontent.com${parsed.pathname.replace('/blob/', '/raw/')}${parsed.search}`;
  }
  return url;
}

/** Downloads a plugin's JSON from a URL (.json extension required). */
async function fetchPluginJsonFromUrl(url: string): Promise<string> {
  const normalized = normalizePluginUrl(url);
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
 * Creates the plugin or updates the one with the same slug (upsert —
 * a re-import updates the definition, like Pelican eggs).
 */
async function upsertPlugin(
  em: EntityManager,
  pluginJson: PluginDefinition,
): Promise<{ slug: string; name: string; created: boolean }> {
  const existing = await em.findOne(Plugin, { slug: pluginJson.id });
  const now = new Date();

  if (existing) {
    existing.name = pluginJson.name;
    existing.schemaVersion = pluginJson.schemaVersion;
    existing.json = pluginJson;
    existing.updatedAt = now;
    await em.flush();
    return { slug: existing.slug, name: existing.name, created: false };
  }

  const plugin = em.create(Plugin, {
    id: randomUUID(),
    slug: pluginJson.id,
    name: pluginJson.name,
    schemaVersion: pluginJson.schemaVersion,
    json: pluginJson,
    createdAt: now,
    updatedAt: now,
  });
  em.persist(plugin);
  await em.flush();
  return { slug: plugin.slug, name: plugin.name, created: true };
}

export const listPluginsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser();
  const orm = await initOrm();
  const em = orm.em.fork();
  const plugins = await em.find(Plugin, {});
  return plugins.map((plugin) => {
    const def = plugin.json as PluginDefinition;
    return {
      id: plugin.id,
      slug: plugin.slug,
      name: plugin.name,
      schemaVersion: plugin.schemaVersion,
      /** Variable definitions (auto-generated form at creation). */
      variables: def.variables ?? [],
      /** Update URL (re-import) if defined by the plugin. */
      updateUrl: def.updateUrl ?? null,
      createdAt: plugin.createdAt,
    };
  });
});

/**
 * Batch plugin import: raw JSONs (textarea/files) + URLs.
 * Each source is processed independently — failures do not cancel
 * successes (per-plugin report, like Pelican egg import).
 */
export const importPluginsFn = createServerFn({ method: 'POST' })
  .validator(importPluginsSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
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
        const raw = source.url ? await fetchPluginJsonFromUrl(source.url) : source.raw;
        if (!raw) throw new HttpError(400, 'JSON vide');
        const pluginJson = parsePluginJson(raw);
        const saved = await upsertPlugin(em, pluginJson);
        imported.push({ ...saved, source: label });
      } catch (err) {
        failed.push({ source: label, error: pluginErrorMessage(err) });
      }
    }

    return { imported, failed };
  });

export const getPluginFn = createServerFn({ method: 'POST' })
  .validator(getPluginSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    const orm = await initOrm();
    const em = orm.em.fork();

    const plugin = await em.findOne(Plugin, { id: data.pluginId });
    if (!plugin) throw new HttpError(404, 'Plugin introuvable');

    return {
      id: plugin.id,
      slug: plugin.slug,
      name: plugin.name,
      schemaVersion: plugin.schemaVersion,
      /** Pretty-printed raw JSON — used for editing AND export. */
      json: JSON.stringify(plugin.json, null, 2),
    };
  });

/**
 * Creates a new plugin from the editor UI (JSON payload validated against
 * the v2 contract). Unlike an import (upsert), a slug clash is REJECTED —
 * the editor shows the conflict instead of silently overwriting.
 */
export const createPluginFn = createServerFn({ method: 'POST' })
  .validator(createPluginSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    const orm = await initOrm();
    const em = orm.em.fork();

    let pluginJson: PluginDefinition;
    try {
      pluginJson = parsePluginJson(data.json);
    } catch (err) {
      throw new HttpError(400, `Plugin invalide : ${pluginErrorMessage(err)}`);
    }

    const clash = await em.findOne(Plugin, { slug: pluginJson.id });
    if (clash) {
      throw new HttpError(409, `Un plugin avec le slug « ${pluginJson.id} » existe déjà`);
    }

    const now = new Date();
    const plugin = em.create(Plugin, {
      id: randomUUID(),
      slug: pluginJson.id,
      name: pluginJson.name,
      schemaVersion: pluginJson.schemaVersion,
      json: pluginJson,
      createdAt: now,
      updatedAt: now,
    });
    em.persist(plugin);
    await em.flush();

    return { id: plugin.id, slug: plugin.slug, name: plugin.name };
  });

/**
 * Edits an existing plugin: the full JSON is revalidated against the v2 schema.
 * The slug (id) can change — uniqueness is rechecked.
 */
export const updatePluginFn = createServerFn({ method: 'POST' })
  .validator(updatePluginSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    const orm = await initOrm();
    const em = orm.em.fork();

    const plugin = await em.findOne(Plugin, { id: data.pluginId });
    if (!plugin) throw new HttpError(404, 'Plugin introuvable');

    let pluginJson: PluginDefinition;
    try {
      pluginJson = parsePluginJson(data.json);
    } catch (err) {
      throw new HttpError(400, `Plugin invalide : ${pluginErrorMessage(err)}`);
    }

    if (pluginJson.id !== plugin.slug) {
      const clash = await em.findOne(Plugin, { slug: pluginJson.id });
      if (clash) {
        throw new HttpError(409, `Un plugin avec le slug « ${pluginJson.id} » existe déjà`);
      }
      plugin.slug = pluginJson.id;
    }

    plugin.name = pluginJson.name;
    plugin.schemaVersion = pluginJson.schemaVersion;
    plugin.json = pluginJson;
    plugin.updatedAt = new Date();
    await em.flush();

    return { id: plugin.id, slug: plugin.slug, name: plugin.name };
  });

export const deletePluginFn = createServerFn({ method: 'POST' })
  .validator(deletePluginSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    const orm = await initOrm();
    const em = orm.em.fork();

    const plugin = await em.findOne(Plugin, { id: data.pluginId });
    if (!plugin) throw new HttpError(404, 'Plugin introuvable');

    const servers = await em.find(Server, { pluginId: plugin.id });
    if (servers.length > 0) {
      throw new HttpError(409, `${servers.length} serveur(s) utilisent ce plugin`);
    }

    em.remove(plugin);
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
  await requireAdmin();
  const orm = await initOrm();
  const em = orm.em.fork();

  const [serverCount, nodeCount, userCount, pluginCount] = await Promise.all([
    em.count(Server),
    em.count(Node),
    em.count(User),
    em.count(Plugin),
  ]);

  const [servers, nodes, plugins, users] = await Promise.all([
    em.find(Server, {}),
    em.find(Node, {}),
    em.find(Plugin, {}),
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
    agentPort: node.agentPort,
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
      pluginName: plugins.find((p) => p.id === server.pluginId)?.name ?? '—',
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
      plugins: pluginCount,
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
  await requireAdmin();
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
    agentPort: node.agentPort,
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
    const user = await requireAdmin();
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
      wsUrl: `ws://${node.fqdn}:${node.agentPort}/health/ws`,
    };
  });
