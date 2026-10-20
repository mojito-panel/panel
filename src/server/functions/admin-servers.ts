import { createServerFn } from '@tanstack/react-start';
import { withOrmContext } from '../middleware';
import type { EntityManager } from '@mikro-orm/core';
import { orm } from '../orm';
import { Node, Recipe, Server, Allocation, ServerUser, User, Backup } from '~/db/entities';
import { adminServersList } from '~/lists/servers';
import { serverAllocationsList } from '~/lists/allocations';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import {
  requirePanelPermission,
  HttpError,
} from '../session';
import {
  agentGetServer,
  agentServerAction,
  agentReinstallServer,
  agentInstallServer,
  agentUpdateAllocation,
  AgentError,
} from '../agent/client';
import { deleteServer } from '../servers';
import {
  adminServerIdSchema,
  adminDeleteServerSchema,
  updateAdminServerSchema,
  setAdminServerSuspendedSchema,
  adminServerAllocationActionSchema,
} from '~/validators/admin-server';

/**
 * Admin-area server management (/admin/servers — Pelican admin "Servers"
 * equivalent): every server of the installation, regardless of owner.
 *
 * Gates: `panel.servers` statements (read / update / delete). The
 * per-server user pages keep their own `server.*` gates — these functions
 * are the admin override path.
 */

/** Loads a server for the admin area — 404 when unknown. */
async function loadServer(serverId: string) {
  const em = orm.em;
  const server = await em.findOne(Server, { id: serverId });
  if (!server) throw new HttpError(404, 'Serveur introuvable');
  return { em, server };
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * Server list of the admin area — filter/sort/pagination run in the database
 * (`adminServersList`), the joined `user` table is pulled in only when a filter
 * or the sort actually needs it.
 */
export const listAdminServersFn = createServerFn({ method: 'POST' })
  .validator(adminServersList.querySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['read'] });
    const em = orm.em;

    const { rows, rowCount } = await runListQuery(
      listQueryBuilder(em, Server, adminServersList),
      adminServersList.spec,
      data,
    );

    // Display names of the current page only (queries stay bounded by pageSize).
    const [nodes, recipes, owners] = await Promise.all([
      em.find(Node, { id: { $in: [...new Set(rows.map((server) => server.nodeId))] } }),
      em.find(Recipe, { id: { $in: [...new Set(rows.map((server) => server.recipeId))] } }),
      em.find(User, { id: { $in: [...new Set(rows.map((server) => server.ownerId))] } }),
    ]);

    const nodeNames = new Map(nodes.map((node) => [node.id, node.name]));
    const recipeNames = new Map(recipes.map((recipe) => [recipe.id, recipe.name]));
    const ownersById = new Map(owners.map((owner) => [owner.id, owner]));

    return {
      rowCount,
      rows: rows.map((server) => {
        const owner = ownersById.get(server.ownerId);
        return {
          id: server.id,
          name: server.name,
          status: server.status,
          suspended: server.suspended,
          nodeName: nodeNames.get(server.nodeId) ?? '—',
          recipeName: recipeNames.get(server.recipeId) ?? '—',
          ownerName: owner?.name ?? null,
          ownerEmail: owner?.email ?? '—',
          createdAt: server.createdAt,
        };
      }),
    };
  });

// ─── Detail (DB only — the live status is a separate polled query) ──────────

export const getAdminServerFn = createServerFn({ method: 'GET' })
  .validator(adminServerIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['read'] });
    const { em, server } = await loadServer(data.serverId);

    const [node, recipe, owner] = await Promise.all([
      em.findOne(Node, { id: server.nodeId }),
      em.findOne(Recipe, { id: server.recipeId }),
      em.findOne(User, { id: server.ownerId }),
    ]);
    if (!node || !recipe) throw new HttpError(500, 'Configuration du serveur incomplète');

    const allocations = (await em.find(Allocation, { serverId: server.id }))
      .sort((a, b) => a.port - b.port)
      .map(allocationDto);

    const subuserCount = await em.count(ServerUser, { serverId: server.id });
    const backupCount = await em.count(Backup, { serverId: server.id });

    return {
      id: server.id,
      name: server.name,
      // DB status — the header badge shows the LIVE status instead
      // (getAdminServerStatusFn, polled), this is the fallback.
      status: server.status,
      suspended: server.suspended,
      memoryMb: server.memoryMb,
      cpuCores: Number(server.cpuCores),
      backupLimit: server.backupLimit,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      node: { id: node.id, name: node.name, fqdn: node.fqdn, sftpPort: node.sftpPort },
      recipe: { id: recipe.id, name: recipe.name, slug: recipe.slug },
      owner: owner
        ? { id: owner.id, name: owner.name, email: owner.email }
        : null,
      allocations,
      subuserCount,
      backupCount,
    };
  });

/**
 * Live runtime status — ONE agent query (best-effort, like the node page's
 * health ping), syncing the persisted status so the rest of the panel sees
 * it too. Polled by the header at a regular interval; the DB status is the
 * fallback while it is in flight.
 */
export const getAdminServerStatusFn = createServerFn({ method: 'GET' })
  .validator(adminServerIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['read'] });
    const { em, server } = await loadServer(data.serverId);
    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Configuration du serveur incomplète');

    let status = server.status;
    try {
      const info = await agentGetServer(node, server.id);
      status = info.status;
      // Sync the persisted status so the rest of the panel sees it too
      if (status !== server.status) {
        server.status = status;
        await em.flush();
      }
    } catch {
      // Agent unreachable → serve the DB status
    }

    return { status };
  });

// ─── Update (name, owner transfer, limits) ────────────────────────────────────

export const updateAdminServerFn = createServerFn({ method: 'POST' })
  .validator(updateAdminServerSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['update'] });
    const { em, server } = await loadServer(data.serverId);

    // Owner transfer: the target user must exist (Pelican owner select)
    if (data.ownerId !== server.ownerId) {
      const owner = await em.findOne(User, { id: data.ownerId });
      if (!owner) throw new HttpError(404, 'Utilisateur propriétaire introuvable');
      server.ownerId = data.ownerId;
    }

    server.name = data.name;
    server.memoryMb = data.memoryMb;
    server.cpuCores = data.cpuCores;
    server.backupLimit = data.backupLimit;
    await em.flush();

    // NOTE: memory/CPU are enforced by the agent through its stored
    // allocation — the power start/restart flow pushes the current
    // record before every spawn, so a limit change applies on the next
    // start. The backup limit is panel-side only and applies immediately.
    return { id: server.id, updated: true };
  });

// ─── Suspend / unsuspend (Pelican SuspensionService) ──────────────────────────

export const setAdminServerSuspendedFn = createServerFn({ method: 'POST' })
  .validator(setAdminServerSuspendedSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['update'] });
    const { em, server } = await loadServer(data.serverId);

    if (data.suspended === server.suspended) {
      return { id: server.id, suspended: server.suspended };
    }

    if (data.suspended) {
      // Best-effort graceful stop, like wings' suspend (the panel-side flags
      // remain the source of truth even when the agent is unreachable).
      const node = await em.findOne(Node, { id: server.nodeId });
      if (node) {
        try {
          const result = await agentServerAction(node, server.id, 'stop');
          server.status = result.status;
        } catch {
          // Agent unreachable/out of sync — the start gate (serverActionFn)
          // and the access gate (loadServerForViewer) still enforce the
          // suspension on the panel side.
        }
      }
      server.suspended = true;
    } else {
      server.suspended = false;
    }

    await em.flush();
    return { id: server.id, suspended: server.suspended };
  });

// ─── Reinstall (admin variant of reinstallServerFn, panel-level gate) ─────────

export const reinstallAdminServerFn = createServerFn({ method: 'POST' })
  .validator(adminServerIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['update'] });
    const { em, server } = await loadServer(data.serverId);

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    // The CURRENT recipe is sent — an update of the recipe JSON is picked
    // up on reinstall, like an egg update in Pelican.
    const recipe = await em.findOne(Recipe, { id: server.recipeId });
    if (!recipe) throw new HttpError(500, 'Recette introuvable');

    const allocation = (await em.find(Allocation, { serverId: server.id }))
      .sort((a, b) => a.port - b.port)
      .find((a) => a.primary);
    if (!allocation) throw new HttpError(500, 'Allocation introuvable');

    try {
      const result = await agentReinstallServer(node, server.id, {
        recipe: recipe.json,
        variables: server.variables,
      });
      // The reinstall runs in the background — the admin follows it from
      // the server's console page (live install panel)
      server.status = 'installing';
      await em.flush();
      return { id: server.id, status: 'installing', message: result.message };
    } catch (err) {
      // The agent doesn't know the server (404): its store is only written
      // on install SUCCESS, so a failed install — or a lost agent dataDir —
      // leaves the panel DB and the agent out of sync. Fall back to a FULL
      // install, rebuilt from the panel DB (same installDir convention).
      if (err instanceof AgentError && err.statusCode === 404) {
        try {
          await agentInstallServer(node, {
            serverId: server.id,
            name: server.name,
            recipe: recipe.json,
            variables: server.variables,
            installDir: `servers/${server.id}`,
            allocation: {
              port: allocation.port,
              memoryMb: server.memoryMb,
              cpuCores: Number(server.cpuCores),
              ip: allocation.ip,
            },
          });
          server.status = 'installing';
          await em.flush();
          return {
            id: server.id,
            status: 'installing',
            message: 'Réinstallation démarrée (installation complète)',
          };
        } catch (fallbackErr) {
          if (fallbackErr instanceof AgentError) {
            throw new HttpError(502, `Réinstallation refusée côté agent : ${fallbackErr.message}`);
          }
          throw fallbackErr;
        }
      }
      if (err instanceof AgentError) {
        throw new HttpError(502, `Réinstallation refusée côté agent : ${err.message}`);
      }
      throw err;
    }
  });

// ─── Deletion (admin variant of deleteServerFn, panel-level gate) ────────────

export const deleteAdminServerFn = createServerFn({ method: 'POST' })
  .validator(adminDeleteServerSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['delete'] });
    const { server } = await loadServer(data.serverId);
    await deleteServer(server, { force: data.force });
    return { deleted: true };
  });

// ─── Allocations (Pelican AllocationsRelationManager) ────────────────────────

/**
 * Pushes the server's full allocation to the agent's cache — primary
 * port/ip plus the current memory/cpu limits, one complete record. A 404
 * (agent out of sync) is tolerated: the panel DB remains the source of
 * truth. Same semantics as the Network page's sync in servers.ts.
 */
async function pushPrimaryAllocation(
  em: EntityManager,
  server: { id: string; nodeId: string; memoryMb: number | string; cpuCores: number | string },
): Promise<void> {
  const node = await em.findOne(Node, { id: server.nodeId });
  if (!node) return;
  const primary = (await em.find(Allocation, { serverId: server.id })).find(
    (a) => a.primary,
  );
  if (!primary) return;
  try {
    await agentUpdateAllocation(node, server.id, {
      port: primary.port,
      ip: primary.ip,
      memoryMb: Number(server.memoryMb),
      cpuCores: Number(server.cpuCores),
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

/** Serializable allocation DTO of the server detail payload. */
function allocationDto(allocation: {
  id: string;
  ip: string;
  port: number;
  alias: string | null | undefined;
  primary: boolean;
}) {
  return {
    id: allocation.id,
    ip: allocation.ip,
    port: allocation.port,
    alias: allocation.alias ?? null,
    primary: allocation.primary,
  };
}

/** Row of the free-allocation picker of the "add" form (claim candidates). */
function allocationPickerDto(allocation: {
  id: string;
  ip: string;
  port: number;
  alias: string | null | undefined;
}) {
  return {
    id: allocation.id,
    ip: allocation.ip,
    port: allocation.port,
    alias: allocation.alias ?? null,
  };
}

/**
 * Allocations of a server — the admin record's own allocation table. Filter/
 * sort/pagination run in the database (`serverAllocationsList`); the server id
 * is a route param, applied to the query builder BEFORE `runListQuery` (never
 * a search param). The free pool of the node comes from the unpaginated
 * `listAdminServerFreeAllocationsFn` picker below.
 */
export const listAdminServerAllocationsFn = createServerFn({ method: 'POST' })
  .validator(serverAllocationsList.querySchema.and(adminServerIdSchema))
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['read'] });
    const { em, server } = await loadServer(data.serverId);

    const qb = listQueryBuilder(em, Allocation, serverAllocationsList);
    qb.andWhere({ serverId: server.id });

    const { rows, rowCount } = await runListQuery(qb, serverAllocationsList.spec, data);

    return {
      rowCount,
      rows: rows.map((allocation) => ({
        id: allocation.id,
        ip: allocation.ip ?? '0.0.0.0',
        port: allocation.port,
        alias: allocation.alias ?? null,
        primary: allocation.primary ?? false,
      })),
    };
  });

/**
 * Free allocations of the server's node — the unpaginated PICKER helper of the
 * "add an allocation" form (the claim needs every candidate at once). A picker
 * must never go through the paginated list function above.
 */
export const listAdminServerFreeAllocationsFn = createServerFn({ method: 'GET' })
  .validator(adminServerIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['read'] });
    const { em, server } = await loadServer(data.serverId);

    const free = await em.find(Allocation, { nodeId: server.nodeId, serverId: null });
    return free.sort((a, b) => a.port - b.port).map(allocationPickerDto);
  });

/** Claims a FREE allocation of the server's node and assigns it to the server. */
export const addAdminServerAllocationFn = createServerFn({ method: 'POST' })
  .validator(adminServerAllocationActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['update'] });
    const { em, server } = await loadServer(data.serverId);

    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation) throw new HttpError(404, 'Allocation introuvable');
    if (allocation.serverId !== null) {
      throw new HttpError(409, 'Cette allocation est déjà utilisée par un autre serveur');
    }
    if (allocation.nodeId !== server.nodeId) {
      throw new HttpError(422, 'Cette allocation n’appartient pas au node du serveur');
    }

    // A server without any primary (legacy data) promotes the newcomer and
    // syncs the agent — otherwise the primary is left untouched
    const hadPrimary = (await em.find(Allocation, { serverId: server.id })).some(
      (a) => a.primary,
    );
    allocation.serverId = server.id;
    allocation.primary = !hadPrimary;
    await em.flush();

    if (!hadPrimary) await pushPrimaryAllocation(em, server);
    return { id: allocation.id };
  });

/**
 * Releases a non-primary allocation — it returns to the node's free pool.
 * The primary must be moved first (refuse otherwise, like Pelican).
 */
export const removeAdminServerAllocationFn = createServerFn({ method: 'POST' })
  .validator(adminServerAllocationActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['update'] });
    const { em, server } = await loadServer(data.serverId);

    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation || allocation.serverId !== server.id) {
      throw new HttpError(404, 'Allocation introuvable pour ce serveur');
    }
    if (allocation.primary) {
      throw new HttpError(409, 'Définis une autre allocation principale avant de retirer celle-ci');
    }

    allocation.serverId = null;
    allocation.primary = false;
    await em.flush();

    return { id: allocation.id };
  });

/**
 * Sets the primary allocation (source of SERVER_PORT / SERVER_IP) and
 * pushes it to the agent — the change applies at the next start.
 */
export const setPrimaryAdminServerAllocationFn = createServerFn({ method: 'POST' })
  .validator(adminServerAllocationActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.servers': ['update'] });
    const { em, server } = await loadServer(data.serverId);

    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation || allocation.serverId !== server.id) {
      throw new HttpError(404, 'Allocation introuvable pour ce serveur');
    }

    const assigned = await em.find(Allocation, { serverId: server.id });
    for (const entry of assigned) {
      entry.primary = entry.id === allocation.id;
    }
    await em.flush();

    await pushPrimaryAllocation(em, server);
    return { id: allocation.id };
  });
