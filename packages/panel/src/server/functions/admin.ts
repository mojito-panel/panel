import { createServerFn } from '@tanstack/react-start';
import { randomBytes, randomUUID } from 'node:crypto';
import { initOrm } from '~/db';
import { Node, Plugin, Server } from '~/db/entities';
import { parsePlugin } from '@mojito/contract';
import { requireUser, requireAdmin, HttpError } from '../session';
import {
  createNodeSchema,
  deleteNodeSchema,
  createPluginSchema,
  deletePluginSchema,
} from '~/validators/node';

// ─── Nodes (admin) ─────────────────────────────────────────────────────────────

/**
 * Liste des nodes — accessible à tout utilisateur connecté (sélection de node
 * à la création d'un serveur). Le token n'est JAMAIS exposé ici.
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

    // Le token est retourné UNE seule fois — l'admin le copie dans la config
    // de l'agent (AGENT_TOKEN) et il ne sera plus jamais rejouable en clair.
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

    // Refuser la suppression si des serveurs y sont encore installés
    const servers = await em.find(Server, { nodeId: node.id });
    if (servers.length > 0) {
      throw new HttpError(409, `${servers.length} serveur(s) encore installé(s) sur ce node`);
    }

    em.remove(node);
    await em.flush();
    return { deleted: true };
  });

// ─── Plugins ───────────────────────────────────────────────────────────────────

export const listPluginsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireUser();
  const orm = await initOrm();
  const em = orm.em.fork();
  const plugins = await em.find(Plugin, {});
  return plugins.map((plugin) => ({
    id: plugin.id,
    slug: plugin.slug,
    name: plugin.name,
    schemaVersion: plugin.schemaVersion,
    /** Définitions des variables (formulaire auto-généré à la création). */
    variables: (plugin.json as ReturnType<typeof parsePlugin>).variables ?? [],
    createdAt: plugin.createdAt,
  }));
});

export const createPluginFn = createServerFn({ method: 'POST' })
  .validator(createPluginSchema)
  .handler(async ({ data }) => {
    await requireAdmin();
    const orm = await initOrm();
    const em = orm.em.fork();

    // Validation stricte du JSON (schéma v2 du contract)
    let pluginJson: ReturnType<typeof parsePlugin>;
    try {
      pluginJson = parsePlugin(JSON.parse(data.json));
    } catch (err) {
      throw new HttpError(400, `Plugin invalide : ${(err as Error).message}`);
    }

    // Slug unique
    const existing = await em.findOne(Plugin, { slug: pluginJson.id });
    if (existing) {
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
