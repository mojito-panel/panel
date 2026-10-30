import { createServerFn } from '@tanstack/react-start';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import { Node, Recipe, Server, Allocation, ServerUser, User, Backup } from '~/db/entities';
import { adminServersList } from '~/lists/servers';
import { serverAllocationsList } from '~/lists/allocations';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import {
  requirePanelPermission,
  HttpError,
} from '../session';
import { logActivity } from '../activity';
import {
  agentGetServer,
  agentServerAction,
} from '../agent/client';
import {
  deleteServer,
  reinstallServerFromPanel,
  refreshServerRecipeSnapshot,
  pushServerResources,
} from '../servers';
import {
  claimServerAllocation,
  releaseServerAllocation,
  promoteServerAllocation,
} from '../nodes';
import {
  recipeGraphUpdatedAt,
  serverRecipeSnapshot,
  isRecipeSnapshotOutdated,
} from '../recipe-snapshot';
import {
  adminServerIdSchema,
  adminDeleteServerSchema,
  adminChangeServerRecipeSchema,
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
    // The snapshot the reload gating compares against (backfilled when the
    // server predates snapshots).
    const snapshot = await serverRecipeSnapshot(server);

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
      recipe: {
        id: recipe.id,
        name: recipe.name,
        slug: recipe.slug,
        // Latest edit of the WHOLE recipe graph (app + required runtimes)
        // — informational only.
        updatedAt: await recipeGraphUpdatedAt(
          recipe.json as Record<string, unknown>,
          recipe.updatedAt,
        ),
        // Reload-recipe gating: the current graph content vs the snapshot's
        // stored hash (never the `updated_at` dates — a sync moves them
        // without changing anything).
        outdated: await isRecipeSnapshotOutdated(
          server,
          recipe.json as Record<string, unknown>,
          recipe.updatedAt,
        ),
        syncedAt: server.recipeSyncedAt,
      },
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
 * fallback while it is in flight. `live` tells the two apart: only a real
 * agent answer may show the live sonar rings, a DB fallback is never live.
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
    let live = false;
    try {
      // Validated against the contract — the parsed status is the only
      // thing trusted into the panel row.
      const info = await agentGetServer(node, server.id);
      status = info.status;
      live = true;
      // Sync the persisted status so the rest of the panel sees it too
      if (status !== server.status) {
        server.status = status;
        await em.flush();
      }
    } catch {
      // Agent unreachable → serve the DB status (never marked live)
    }

    return { status, live };
  });

// ─── Update (name, owner transfer, limits) ────────────────────────────────────

export const updateAdminServerFn = createServerFn({ method: 'POST' })
  .validator(updateAdminServerSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.servers': ['update'] });
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

    // Push the new limits to the agent's cache right away: the crash
    // auto-restart (agent-side) and any start path that bypasses the
    // panel spawn from the stored cache — a save without push would leave
    // them running under the OLD limits. Best-effort: the DB is the
    // source of truth and the power start/restart flow re-pushes anyway.
    try {
      await pushServerResources(server);
    } catch {
      // Agent unreachable — tolerated, the next start re-syncs.
    }

    await logActivity({ event: 'server:update', description: `Serveur « ${server.name} » mis à jour (administration)`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { ownerId: server.ownerId, memoryMb: server.memoryMb, cpuCores: Number(server.cpuCores), backupLimit: server.backupLimit } });

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
    const user = await requirePanelPermission({ 'panel.servers': ['update'] });
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
    await logActivity({ event: 'server:suspend', description: data.suspended ? `Serveur « ${server.name} » suspendu` : `Serveur « ${server.name} » réactivé`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { suspended: data.suspended } });

    return { id: server.id, suspended: server.suspended };
  });

// ─── Reinstall (admin variant of reinstallServerFn, panel-level gate) ─────────

export const reinstallAdminServerFn = createServerFn({ method: 'POST' })
  .validator(adminServerIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.servers': ['update'] });
    const { server } = await loadServer(data.serverId);

    // The STORED snapshot is re-run — a recipe updated in the panel never
    // impacts an installed server; reload/change recipe are the explicit
    // propagation paths.
    const result = await reinstallServerFromPanel(server);
    server.status = 'installing';
    await orm.em.flush();
    await logActivity({ event: 'server:reinstall', description: `Réinstallation de « ${server.name} » lancée (administration)`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { admin: true } });
    return { id: server.id, status: 'installing', message: result.message };
  });

// ─── Recipe propagation (reload / change — the admin override path) ─────────

/**
 * Reload recipe: re-snapshots the server from the CURRENT recipe row
 * (app + resolved runtimes, current variable values kept) WITHOUT
 * reinstalling — the reinstall stays a separate, explicit action so the
 * variables can be reviewed first. The user-facing equivalent lives on
 * the server settings page.
 */
export const reloadAdminServerRecipeFn = createServerFn({ method: 'POST' })
  .validator(adminServerIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.servers': ['update'] });
    const { server } = await loadServer(data.serverId);

    await refreshServerRecipeSnapshot(server);
    await logActivity({ event: 'server:reload_recipe', description: `Recette de « ${server.name} » rechargée (administration)`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { admin: true } });
    return {
      id: server.id,
      status: server.status,
      // The variables to review before the (separate) reinstall
      variables: server.variables,
    };
  });

/**
 * Change recipe: points the server at another recipe, re-snapshots from it
 * and reinstalls — the variables keep their current values for every env
 * the new recipe still declares, defaults fill the new ones.
 */
export const changeAdminServerRecipeFn = createServerFn({ method: 'POST' })
  .validator(adminChangeServerRecipeSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.servers': ['update'] });
    const { server } = await loadServer(data.serverId);

    const result = await reinstallServerFromPanel(server, {
      recipeId: data.recipeId,
      refreshSnapshot: true,
    });
    server.status = 'installing';
    await orm.em.flush();
    await logActivity({ event: 'server:change_recipe', description: `Recette de « ${server.name} » changée puis réinstallation lancée`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { recipeId: data.recipeId } });
    return { id: server.id, status: 'installing', message: result.message };
  });

// ─── Deletion (admin variant of deleteServerFn, panel-level gate) ────────────

export const deleteAdminServerFn = createServerFn({ method: 'POST' })
  .validator(adminDeleteServerSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.servers': ['delete'] });
    const { server } = await loadServer(data.serverId);
    await deleteServer(server, { force: data.force });
    await logActivity({ event: 'server:delete', description: `Serveur « ${server.name} » supprimé (administration)`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { force: data.force ?? false } });
    return { deleted: true };
  });

// ─── Allocations (Pelican AllocationsRelationManager) ────────────────────────

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
    const user = await requirePanelPermission({ 'panel.servers': ['update'] });
    const { server } = await loadServer(data.serverId);

    const allocation = await claimServerAllocation(server, data.allocationId);
    await logActivity({ event: 'server:allocation_add', description: `Allocation ${allocation.ip}:${allocation.port} ajoutée à « ${server.name} » (administration)`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { allocationId: allocation.id } });
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
    const user = await requirePanelPermission({ 'panel.servers': ['update'] });
    const { server } = await loadServer(data.serverId);

    const allocation = await releaseServerAllocation(server, data.allocationId);
    await logActivity({ event: 'server:allocation_remove', description: `Allocation ${allocation.ip}:${allocation.port} retirée de « ${server.name} » (administration)`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { allocationId: allocation.id } });
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
    const user = await requirePanelPermission({ 'panel.servers': ['update'] });
    const { server } = await loadServer(data.serverId);

    const allocation = await promoteServerAllocation(server, data.allocationId);
    await logActivity({ event: 'server:allocation_primary', description: `Allocation ${allocation.ip}:${allocation.port} définie principale sur « ${server.name} » (administration)`, actor: { id: user.id, name: user.name, email: user.email }, server: { id: server.id, name: server.name }, properties: { allocationId: allocation.id } });
    return { id: allocation.id };
  });
