import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { Node, Recipe, Server, ServerUser, Allocation } from '~/db/entities';
import { userServersList } from '~/lists/user-servers';
import { serverAllocationsList } from '~/lists/allocations';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import { normalizeStoredRecipe } from '~/lib/stored-recipe';
import type { Recipe as RecipeContract } from '~/contract';
import {
  requireUser,
  HttpError,
  loadServerForViewer,
  loadServerWithPermission,
  requireServerOwner,
} from '../session';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import {
  requireNodeOf,
  requireRecipeOf,
  findPrimaryAllocation,
  pushPrimaryAllocation,
  installServer,
  deleteServer,
  syncRuntimeStatus,
  loadServerContext,
} from '../servers';
import { signConsoleToken } from '../jwt';
import { decryptSecret } from '../crypto';
import { toConsolePermissions } from '~/lib/permissions';
import {
  agentInstallServer,
  agentGetServerLogs,
  agentGetInstallStatus,
  agentServerAction,
  agentSendCommand,
  agentReinstallServer,
  agentUpdateServerVariables,
  AgentError,
} from '../agent/client';
import { validateVariableValue } from '~/contract';
import {
  createServerSchema,
  updateServerVariablesSchema,
  serverActionInputSchema,
  sendCommandSchema,
  serverDetailQuerySchema,
  serverLogsQuerySchema,
  deleteServerSchema,
  serverAllocationActionSchema,
} from '~/validators/server';
import { isHttpsScheme } from '~/validators/node';

type ServerStatusDb =
  | 'installing'
  | 'install_failed'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed';

/**
 * Visibility scope of the viewer on the server table: an admin sees every
 * server, anyone else the ones they own PLUS the ones shared with them through
 * a `server_user` grant (Pelican sub-user semantics). `null` = no restriction.
 */
async function viewerServerScope(user: { id: string; role: string }) {
  const em = orm.em;
  if (user.role === 'admin') return null;
  const grants = await em.find(ServerUser, { userId: user.id });
  return {
    $or: [
      { ownerId: user.id },
      { id: { $in: grants.map((grant) => grant.serverId) } },
    ],
  };
}


/**
 * Server list of the signed-in user — filter/search/sort/pagination run in the
 * database (`userServersList`). The visibility scope above is a base condition
 * applied to the query builder before the shared list query runs.
 */
export const listServersFn = createServerFn({ method: 'POST' })
  .validator(userServersList.querySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const em = orm.em;

    const qb = listQueryBuilder(em, Server, userServersList);
    const scope = await viewerServerScope(user);
    if (scope) qb.where(scope);

    const { rows, rowCount } = await runListQuery(qb, userServersList.spec, data);

    // Node names of the current page only (the query stays bounded by pageSize).
    const nodes = await em.find(Node, {
      id: { $in: [...new Set(rows.map((server) => server.nodeId))] },
    });
    const nodeNames = new Map(nodes.map((node) => [node.id, node.name]));

    return {
      rowCount,
      rows: rows.map((server) => ({
        id: server.id,
        name: server.name,
        status: server.status,
        nodeName: nodeNames.get(server.nodeId) ?? '—',
        createdAt: server.createdAt,
      })),
    };
  });

// ─── Picker options ───────────────────────────────────────────────────────────

/**
 * Picker variant of the list — the full `{ id, name }` set visible to the viewer
 * (same scope as `listServersFn`), optionally restricted to one node. NOT
 * paginated: assignment pickers need every candidate. Keep paginated list
 * functions out of pickers.
 */
export const listServerOptionsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ nodeId: z.string().optional() }))
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const em = orm.em;

    const qb = listQueryBuilder(em, Server, userServersList);
    const scope = await viewerServerScope(user);
    if (scope) qb.where(scope);
    if (data.nodeId) qb.andWhere({ nodeId: data.nodeId });

    const servers = await qb.orderBy({ name: 'ASC' }).getResult();
    return servers.map((server) => ({ id: server.id, name: server.name }));
  });

// ─── Creation (install via the agent) ────────────────────────────────────────────

export const installServerFn = createServerFn({ method: 'POST' })
  .validator(createServerSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    return installServer(data, user);
  });

// ─── Install status + logs (live install panel) ──────────────────────────────

export const getInstallStatusFn = createServerFn({ method: 'GET' })
  .validator(serverLogsQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.console': ['read'] },
    );
    const node = await requireNodeOf(server);

    try {
      const status = await agentGetInstallStatus(node, server.id);

      // Keep the DB status in sync with the install outcome
      if (status.status === 'installed' && server.status === 'installing') {
        server.status = 'stopped';
        await em.flush();
      } else if (status.status === 'failed' && server.status !== 'install_failed') {
        server.status = 'install_failed';
        await em.flush();
      }
      return status;
    } catch {
      // Agent unreachable (or the server predates install tracking) →
      // derive the answer from the DB status
      const status =
        server.status === 'installing'
          ? ('installing' as const)
          : server.status === 'install_failed'
            ? ('failed' as const)
            : ('installed' as const);
      return {
        serverId: server.id,
        status,
        step: 0,
        totalSteps: 0,
        percent: status === 'installed' ? 100 : 0,
        message:
          status === 'installing'
            ? 'Agent unreachable — status unknown'
            : status === 'failed'
              ? 'Installation failed (logs unavailable)'
              : 'Installed',
        error: null,
        logs: [],
        startedAt: null,
        finishedAt: null,
      };
    }
  });

// ─── Install retry (after a failed install) ─────────────────────────────────

export const retryInstallFn = createServerFn({ method: 'POST' })
  .validator(serverLogsQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.settings': ['update'] },
    );

    const node = await requireNodeOf(server);
    const recipe = await requireRecipeOf(server);
    const allocation = await findPrimaryAllocation(server.id);
    if (!allocation) throw new HttpError(500, 'Allocation introuvable');

    try {
      await agentInstallServer(node, {
        serverId: server.id,
        name: server.name,
        recipe: normalizeStoredRecipe(recipe.json),
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
      return { id: server.id, status: 'installing' };
    } catch (err) {
      server.status = 'install_failed';
      await em.flush();
      if (err instanceof AgentError) {
        throw new HttpError(502, `Nouvelle tentative refusée par l'agent : ${err.message}`);
      }
      throw err;
    }
  });

// ─── Detail (DB only — always fast, never waits on the agent) ───────────────

export const getServerFn = createServerFn({ method: 'GET' })
  .validator(serverDetailQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server, viewer } = await loadServerForViewer(data.serverId, user);
    const { node, recipe, primaryAllocation } = await loadServerContext(server);

    if (!node || !recipe) {
      throw new HttpError(500, 'Configuration du serveur incomplète');
    }

    const recipeJson = recipe.json as RecipeContract;

    // Sub-users only see the variables/startup command with the matching
    // grant — owners/admins always pass (their list is the full set)
    const canReadVariables = viewer.permissions.includes('server.variables.read');

    return {
      id: server.id,
      name: server.name,
      // Persisted status (DB) — the LIVE agent status is a separate
      // best-effort query (getServerRuntimeFn), so a slow/unreachable
      // agent never blocks the page or hides the sidebar menu.
      status: server.status as ServerStatusDb,
      ownerId: server.ownerId,
      variables: canReadVariables ? server.variables : {},
      createdAt: server.createdAt,
      node: { id: node.id, name: node.name, fqdn: node.fqdn, sftpPort: node.sftpPort },
      recipe: {
        id: recipe.id,
        name: recipe.name,
        slug: recipe.slug,
        // Variable definitions for the UI (forms)
        variables: canReadVariables ? (recipeJson.variables ?? []) : [],
        start: canReadVariables ? recipeJson.start : null,
        // Backup contents (glob include patterns) shown on the Backups page
        backup: recipeJson.backup ?? null,
      },
      allocation: primaryAllocation
        ? {
            port: primaryAllocation.port,
            ip: primaryAllocation.ip,
            memoryMb: server.memoryMb,
            cpuCores: Number(server.cpuCores),
          }
        : null,
      // What the current user can do on this server (sidebar + page gating)
      viewer: {
        isOwner: viewer.isOwner,
        isAdmin: viewer.isAdmin,
        isSubuser: viewer.isSubuser,
        permissions: viewer.permissions,
      },
    };
  });

// ─── Live runtime status (agent, best-effort + DB sync) ─────────────────────

/**
 * Live status of the server as reported by the agent. An unreachable agent
 * is NOT an error: `status` comes back `null` and the UI shows "Inconnu"
 * (the persisted DB status may be out of sync — never served as live).
 */
export const getServerRuntimeFn = createServerFn({ method: 'GET' })
  .validator(serverDetailQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerForViewer(data.serverId, user);
    const live = await syncRuntimeStatus(server);
    return { status: live?.status ?? null, runtimeState: live?.runtimeState ?? null };
  });

// ─── Power action (start/stop/restart/kill) ───────────────────────────────────

export const serverActionFn = createServerFn({ method: 'POST' })
  .validator(serverActionInputSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.power': [data.action] },
    );

    // A suspended server can only be stopped/killed (Pelican semantics) —
    // start/restart are refused until an admin reactivates it.
    if (server.suspended && (data.action === 'start' || data.action === 'restart')) {
      throw new HttpError(409, 'Ce serveur est suspendu — réactivation requise avant tout démarrage');
    }

    // Limits sync: the agent builds the server's Job Object from its
    // stored allocation — push the panel's current record before the
    // spawn (install pushes it once; start/restart are the only refresh
    // moments, nothing can change at runtime).
    if (data.action === 'start' || data.action === 'restart') {
      await pushPrimaryAllocation(server);
    }

    const node = await requireNodeOf(server);

    try {
      const result = await agentServerAction(node, server.id, data.action);
      // Sync the status
      server.status = result.status as ServerStatusDb;
      await em.flush();
      return { id: server.id, action: data.action, status: result.status };
    } catch (err) {
      if (err instanceof AgentError) {
        throw new HttpError(502, `Action échouée côté agent : ${err.message}`);
      }
      throw err;
    }
  });

// ─── Reinstall (stop + re-run the recipe's install script) ────────────────────

export const reinstallServerFn = createServerFn({ method: 'POST' })
  .validator(serverLogsQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.settings': ['update'] },
    );

    const node = await requireNodeOf(server);

    // The CURRENT recipe is sent — an update of the recipe JSON is picked up
    // on reinstall, like an egg update in Pelican.
    const recipe = await requireRecipeOf(server);
    const allocation = await findPrimaryAllocation(server.id);
    if (!allocation) throw new HttpError(500, 'Allocation introuvable');

    try {
      const result = await agentReinstallServer(node, server.id, {
        recipe: normalizeStoredRecipe(recipe.json),
        variables: server.variables,
      });
      // The reinstall now runs in the background — the console shows the
      // live install panel (steps + logs) while it goes
      server.status = 'installing';
      await em.flush();
      return { id: server.id, status: 'installing', message: result.message };
    } catch (err) {
      // The agent doesn't know the server (404): its store is only written on
      // install SUCCESS, so a failed install — or a lost agent dataDir —
      // leaves the panel DB and the agent out of sync. Fall back to a FULL
      // install, rebuilt from the panel DB (same installDir convention).
      if (err instanceof AgentError && err.statusCode === 404) {
        try {
          await agentInstallServer(node, {
            serverId: server.id,
            name: server.name,
            recipe: normalizeStoredRecipe(recipe.json),
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

// ─── Variable update (panel DB = source of truth, agent cache synced) ────────

export const updateServerVariablesFn = createServerFn({ method: 'POST' })
  .validator(updateServerVariablesSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.variables': ['update'] },
    );

    const recipe = await requireRecipeOf(server);
    const recipeJson = recipe.json as RecipeContract;

    // Merge: only user_editable variables accept the submitted values, the
    // others keep their current value (Pelican semantics — non-editable
    // variables are read-only for the owner)
    const variables: Record<string, string | number | boolean> = { ...server.variables };
    for (const variable of recipeJson.variables ?? []) {
      if (variable.user_editable && data.variables[variable.env] !== undefined) {
        variables[variable.env] = data.variables[variable.env];
      }
    }

    // Same validation rules as the install (contract reuse)
    for (const variable of recipeJson.variables ?? []) {
      const value = variables[variable.env];
      if ((value === undefined || value === '') && variable.required) {
        throw new HttpError(422, `${variable.name} est requis`);
      }
      if (value !== undefined && value !== '') {
        const error = validateVariableValue(variable, value);
        if (error) throw new HttpError(422, error);
      }
    }

    // Sync the agent's cache first — it resolves variables at start (including
    // starts triggered directly over the browser WS, without the panel). A 404
    // (the agent doesn't know the server: failed install, lost dataDir) is
    // tolerated: the panel DB keeps the values and the agent will receive
    // them on the next full install
    const node = await orm.em.findOne(Node, { id: server.nodeId });
    if (node) {
      try {
        await agentUpdateServerVariables(node, server.id, variables);
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

    server.variables = variables;
    await em.flush();

    return { id: server.id, variables };
  });

// ─── Console command ──────────────────────────────────────────────────────────

export const sendCommandFn = createServerFn({ method: 'POST' })
  .validator(sendCommandSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.console': ['command'] },
    );
    const node = await requireNodeOf(server);

    try {
      await agentSendCommand(node, server.id, data.command);
      return { sent: true };
    } catch (err) {
      if (err instanceof AgentError) {
        throw new HttpError(502, `Commande refusée par l'agent : ${err.message}`);
      }
      throw err;
    }
  });

// ─── Incremental logs (live console) ─────────────────────────────────────────

export const getServerLogsFn = createServerFn({ method: 'GET' })
  .validator(serverLogsQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.console': ['read'] },
    );
    const node = await requireNodeOf(server);

    try {
      const chunk = await agentGetServerLogs(node, server.id, data.after);
      return { lines: chunk.lines, next: chunk.next, status: chunk.status };
    } catch (err) {
      if (err instanceof AgentError && err.statusCode === 404) {
        return { lines: [], next: 0, status: server.status as ServerStatusDb };
      }
      throw err;
    }
  });

// ─── Console token (JWT for the browser ↔ agent direct WS) ──────────────────

export const createConsoleTokenFn = createServerFn({ method: 'POST' })
  .validator(serverLogsQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server, viewer } = await loadServerForViewer(data.serverId, user);
    const node = await requireNodeOf(server);

    // Short-lived JWT — the agent validates signature/aud/scope/exp/serverId
    // and gates every console action on the permissions carried in the payload.
    // Pelican-style: signed with the node's OWN agent token (single per-node
    // secret). The permissions come from the viewer's per-server grants —
    // owners/admins get the full set, sub-users only what they were granted
    // (the agent enforces them on every WS message).
    const { token } = signConsoleToken(
      {
        userId: user.id,
        serverId: server.id,
        permissions: toConsolePermissions(viewer.permissions),
      },
      decryptSecret(node.agentToken),
    );

    return {
      token,
      wsUrl: `${isHttpsScheme(node.scheme) ? 'wss' : 'ws'}://${node.fqdn}:${node.publicPort}/servers/${server.id}/ws`,
    };
  });

// ─── Deletion ──────────────────────────────────────────────────────────────

export const deleteServerFn = createServerFn({ method: 'POST' })
  .validator(deleteServerSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await requireServerOwner(data.serverId, user);
    await deleteServer(server, { force: data.force });
    return { deleted: true };
  });

// ─── Network page (allocations) ──────────────────────────────────────────────

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
 * Allocations of a server — the Network page table. Filter/sort/pagination run
 * in the database (`serverAllocationsList`); the server id AND the viewer's
 * `server.network.read` grant are resolved first, then the scope is applied to
 * the query builder BEFORE `runListQuery` (the server id is a route param, not
 * a search param). The free pool of the node comes from the unpaginated picker
 * below.
 */
export const listServerAllocationsFn = createServerFn({ method: 'POST' })
  .validator(
    serverAllocationsList.querySchema.and(
      serverAllocationActionSchema.pick({ serverId: true }),
    ),
  )
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.network': ['read'] },
    );
    const em = orm.em;

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
export const listServerFreeAllocationsFn = createServerFn({ method: 'GET' })
  .validator(serverAllocationActionSchema.pick({ serverId: true }))
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.network': ['read'] },
    );
    const em = orm.em;

    const free = await em.find(Allocation, { nodeId: server.nodeId, serverId: null });
    return free.sort((a, b) => a.port - b.port).map(allocationPickerDto);
  });

/** Claims a FREE allocation of the server's node and assigns it to the server. */
export const addServerAllocationFn = createServerFn({ method: 'POST' })
  .validator(serverAllocationActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.network': ['update'] },
    );

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

    if (!hadPrimary) await pushPrimaryAllocation(server);
    return { id: allocation.id };
  });

/**
 * Releases a non-primary allocation — it returns to the node's free pool.
 * The primary must be moved first (refuse otherwise, like Pelican).
 */
export const removeServerAllocationFn = createServerFn({ method: 'POST' })
  .validator(serverAllocationActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.network': ['update'] },
    );

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
export const setPrimaryServerAllocationFn = createServerFn({ method: 'POST' })
  .validator(serverAllocationActionSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.network': ['update'] },
    );

    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation || allocation.serverId !== server.id) {
      throw new HttpError(404, 'Allocation introuvable pour ce serveur');
    }

    const assigned = await em.find(Allocation, { serverId: server.id });
    for (const entry of assigned) {
      entry.primary = entry.id === allocation.id;
    }
    await em.flush();

    await pushPrimaryAllocation(server);
    return { id: allocation.id };
  });
