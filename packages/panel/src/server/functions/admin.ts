import { createServerFn } from '@tanstack/react-start';
import { randomBytes, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { EntityManager } from '@mikro-orm/core';
import { initOrm } from '~/db';
import { Node, Plugin, Server } from '~/db/entities';
import { parsePlugin, type Plugin as PluginDefinition } from '@mojito/contract';
import { requireUser, requireAdmin, HttpError } from '../session';
import { createNodeSchema, deleteNodeSchema } from '~/validators/node';
import {
  importPluginsSchema,
  getPluginSchema,
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
      agentToken: token,
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
