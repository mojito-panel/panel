import { createServerFn } from '@tanstack/react-start';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/core';
import { initOrm } from '~/db';
import { Node, Recipe, Server, Allocation, ServerUser } from '~/db/entities';
import type { IServer } from '~/db/types';
import type { Recipe as RecipeContract } from '~/contract';
import {
  requireUser,
  HttpError,
  loadServerForViewer,
  loadServerWithPermission,
  requireServerOwner,
} from '../session';
import { signConsoleToken } from '../jwt';
import { decryptSecret } from '../crypto';
import { toConsolePermissions } from '~/lib/permissions';
import {
  agentInstallServer,
  agentGetServer,
  agentGetServerLogs,
  agentGetInstallStatus,
  agentServerAction,
  agentSendCommand,
  agentDeleteServer,
  agentReinstallServer,
  agentUpdateServerVariables,
  agentUpdateAllocation,
  AgentError,
} from '../agent/client';
import { validateVariableValue } from '~/contract';
import {
  createServerSchema,
  updateServerVariablesSchema,
  serverActionInputSchema,
  sendCommandSchema,
  serverLogsQuerySchema,
  serverAllocationActionSchema,
} from '~/validators/server';

type ServerStatusDb =
  | 'installing'
  | 'install_failed'
  | 'stopped'
  | 'running'
  | 'crashed';

// ─── Allocation helpers ───────────────────────────────────────────────────────

/** Loads the server's primary allocation (null when none is assigned). */
async function findPrimaryAllocation(em: EntityManager, serverId: string) {
  const allocations = await em.find(Allocation, { serverId });
  return allocations.find((a) => a.primary) ?? null;
}

/**
 * Pushes the server's primary allocation to the agent's cache — the new
 * port/ip apply at the NEXT start. Same tolerance as the variables sync:
 * a 404 (agent out of sync) is ignored, the DB stays the source of truth.
 */
async function pushPrimaryAllocation(em: EntityManager, server: IServer): Promise<void> {
  const node = await em.findOne(Node, { id: server.nodeId });
  if (!node) return;
  const primary = await findPrimaryAllocation(em, server.id);
  if (!primary) return;
  try {
    await agentUpdateAllocation(node, server.id, {
      port: primary.port,
      ip: primary.ip,
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

// ─── List ─────────────────────────────────────────────────────────────────────

export const listServersFn = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();
  const orm = await initOrm();
  const em = orm.em.fork();

  // Admin sees everything; a user sees their servers PLUS the ones shared
  // with them (Pelican sub-user semantics)
  const servers =
    user.role === 'admin'
      ? await em.find(Server, {})
      : await (async () => {
          const grants = await em.find(ServerUser, { userId: user.id });
          return em.find(Server, {
            $or: [
              { ownerId: user.id },
              { id: { $in: grants.map((grant) => grant.serverId) } },
            ],
          });
        })();

  const nodes = await em.find(Node, {});
  const recipes = await em.find(Recipe, {});

  return servers.map((server) => ({
    id: server.id,
    name: server.name,
    status: server.status,
    nodeId: server.nodeId,
    nodeName: nodes.find((n) => n.id === server.nodeId)?.name ?? '—',
    recipeId: server.recipeId,
    recipeName: recipes.find((p) => p.id === server.recipeId)?.name ?? '—',
    createdAt: server.createdAt,
  }));
});

// ─── Creation (install via the agent) ────────────────────────────────────────────

export const installServerFn = createServerFn({ method: 'POST' })
  .validator(createServerSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: data.nodeId });
    if (!node) throw new HttpError(404, 'Node introuvable');

    const recipe = await em.findOne(Recipe, { id: data.recipeId });
    if (!recipe) throw new HttpError(404, 'Recette introuvable');

    // Pelican semantics: the port comes from the node's allocation pool —
    // the chosen allocation must be free and belong to the selected node
    const allocation = await em.findOne(Allocation, { id: data.allocationId });
    if (!allocation) throw new HttpError(404, 'Allocation introuvable');
    if (allocation.serverId !== null) {
      throw new HttpError(409, 'Cette allocation est déjà utilisée par un autre serveur');
    }
    if (allocation.nodeId !== data.nodeId) {
      throw new HttpError(422, 'Cette allocation n’appartient pas au node sélectionné');
    }

    const serverId = randomUUID();
    const now = new Date();

    // 1. Persist FIRST with status 'installing' — the user is redirected to
    //    the server console right away and follows the install live.
    const server = em.create(Server, {
      id: serverId,
      name: data.name,
      nodeId: data.nodeId,
      recipeId: data.recipeId,
      ownerId: user.id,
      status: 'installing',
      memoryMb: data.memoryMb,
      variables: data.variables,
      createdAt: now,
      updatedAt: now,
    });
    em.persist(server);

    // The claimed allocation becomes the server's primary (port + ip)
    allocation.serverId = serverId;
    allocation.primary = true;
    await em.flush();

    // 2. Start the background install on the agent (fast — the agent only
    //    validates, then runs the runner async and records every step).
    // installDir relative to the agent's dataDir.
    try {
      await agentInstallServer(node, {
        serverId,
        name: data.name,
        recipe: recipe.json,
        variables: data.variables,
        installDir: `servers/${serverId}`,
        allocation: {
          port: allocation.port,
          memoryMb: data.memoryMb,
          ip: allocation.ip,
        },
      });
    } catch (err) {
      // The install could not even start → remove the server row, free the
      // allocation and report
      const em2 = orm.em.fork();
      const dbServer = await em2.findOne(Server, { id: serverId });
      if (dbServer) em2.remove(dbServer);
      const dbAllocation = await em2.findOne(Allocation, { id: allocation.id });
      if (dbAllocation) {
        dbAllocation.serverId = null;
        dbAllocation.primary = false;
      }
      await em2.flush();

      if (err instanceof AgentError) {
        throw new HttpError(502, `Installation refusée par l'agent : ${err.message}`);
      }
      throw err;
    }

    return { id: serverId, name: server.name };
  });

// ─── Install status + logs (live install panel) ──────────────────────────────

export const getInstallStatusFn = createServerFn({ method: 'GET' })
  .validator(serverLogsQuerySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.console': ['read'] },
    );
    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

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
            ? 'Agent injoignable — statut inconnu'
            : status === 'failed'
              ? 'Installation échouée (logs indisponibles)'
              : 'Installé',
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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.settings': ['update'] },
    );

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    const recipe = await em.findOne(Recipe, { id: server.recipeId });
    if (!recipe) throw new HttpError(500, 'Recette introuvable');

    const allocation = await findPrimaryAllocation(em, server.id);
    if (!allocation) throw new HttpError(500, 'Allocation introuvable');

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

// ─── Detail (DB + actual agent runtime state) ─────────────────────────────

export const getServerFn = createServerFn({ method: 'GET' })
  .validator(serverLogsQuerySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server, viewer } = await loadServerForViewer(data.serverId, user);
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: server.nodeId });
    const recipe = await em.findOne(Recipe, { id: server.recipeId });
    const primaryAllocation = await findPrimaryAllocation(em, server.id);

    if (!node || !recipe) {
      throw new HttpError(500, 'Configuration du serveur incomplète');
    }

    // Actual runtime status (may differ from the DB)
    let runtimeStatus: ServerStatusDb = server.status as ServerStatusDb;
    let runtimeState: string | null = null;
    let logs: string[] = [];
    try {
      const info = await agentGetServer(node, server.id);
      runtimeStatus = info.status;
      runtimeState = info.runtimeState ?? null;
      logs = info.logs ?? [];
      // Sync the persisted status
      if (runtimeStatus !== server.status) {
        const em2 = orm.em.fork();
        const dbServer = await em2.findOne(Server, { id: server.id });
        if (dbServer) {
          dbServer.status = runtimeStatus;
          await em2.flush();
        }
      }
    } catch {
      // Agent unreachable → serve the DB state
    }

    const recipeJson = recipe.json as RecipeContract;

    // Sub-users only see the variables/startup command with the matching
    // grant — owners/admins always pass (their list is the full set)
    const canReadVariables = viewer.permissions.includes('server.variables.read');

    return {
      id: server.id,
      name: server.name,
      status: runtimeStatus,
      runtimeState,
      ownerId: server.ownerId,
      variables: canReadVariables ? server.variables : {},
      createdAt: server.createdAt,
      node: { id: node.id, name: node.name, fqdn: node.fqdn },
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
          }
        : null,
      logs,
      // What the current user can do on this server (sidebar + page gating)
      viewer: {
        isOwner: viewer.isOwner,
        isAdmin: viewer.isAdmin,
        isSubuser: viewer.isSubuser,
        permissions: viewer.permissions,
      },
    };
  });

// ─── Power action (start/stop/restart/kill) ───────────────────────────────────

export const serverActionFn = createServerFn({ method: 'POST' })
  .validator(serverActionInputSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.power': [data.action] },
    );

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.settings': ['update'] },
    );

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    // The CURRENT recipe is sent — an update of the recipe JSON is picked up
    // on reinstall, like an egg update in Pelican.
    const recipe = await em.findOne(Recipe, { id: server.recipeId });
    if (!recipe) throw new HttpError(500, 'Recette introuvable');

    const allocation = await findPrimaryAllocation(em, server.id);
    if (!allocation) throw new HttpError(500, 'Allocation introuvable');

    try {
      const result = await agentReinstallServer(node, server.id, {
        recipe: recipe.json,
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
            recipe: recipe.json,
            variables: server.variables,
            installDir: `servers/${server.id}`,
            allocation: {
              port: allocation.port,
              memoryMb: server.memoryMb,
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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.variables': ['update'] },
    );

    const recipe = await em.findOne(Recipe, { id: server.recipeId });
    if (!recipe) throw new HttpError(500, 'Recette introuvable');
    const recipeJson = recipe.json as RecipeContract;

    // Merge: only userEditable variables accept the submitted values, the
    // others keep their current value (Pelican semantics — non-editable
    // variables are read-only for the owner)
    const variables: Record<string, string | number | boolean> = { ...server.variables };
    for (const variable of recipeJson.variables ?? []) {
      if (variable.userEditable && data.variables[variable.env] !== undefined) {
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
    const node = await em.findOne(Node, { id: server.nodeId });
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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.console': ['command'] },
    );
    const orm = await initOrm();
    const em = orm.em.fork();
    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.console': ['read'] },
    );
    const orm = await initOrm();
    const em = orm.em.fork();
    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server, viewer } = await loadServerForViewer(data.serverId, user);
    const orm = await initOrm();
    const em = orm.em.fork();
    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

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
      wsUrl: `ws://${node.fqdn}:${node.agentPort}/servers/${server.id}/ws`,
    };
  });

// ─── Deletion ──────────────────────────────────────────────────────────────

export const deleteServerFn = createServerFn({ method: 'POST' })
  .validator(serverLogsQuerySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await requireServerOwner(data.serverId, user);

    const node = await em.findOne(Node, { id: server.nodeId });

    // Agent cleanup (tolerant: if the agent no longer knows the server, continue)
    if (node) {
      try {
        await agentDeleteServer(node, server.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!(err instanceof AgentError) || err.statusCode !== 404) {
          throw new HttpError(502, `Suppression échouée côté agent : ${message}`);
        }
      }
    }

    // DB deletion — the server's allocations return to the node's free pool
    const allocations = await em.find(Allocation, { serverId: server.id });
    for (const allocation of allocations) {
      allocation.serverId = null;
      allocation.primary = false;
    }
    // The sub-user grants die with the server
    const grants = await em.find(ServerUser, { serverId: server.id });
    em.remove(grants);
    em.remove(server);
    await em.flush();

    return { deleted: true };
  });

// ─── Network page (allocations) ──────────────────────────────────────────────

/** Serializable allocation DTO shared by the Network page queries. */
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

/**
 * Allocations of a server + the free ones of its node (Pelican Network
 * page: list, claim from the pool, set primary, release).
 */
export const getServerNetworkFn = createServerFn({ method: 'GET' })
  .validator(serverLogsQuerySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.network': ['read'] },
    );
    const orm = await initOrm();
    const em = orm.em.fork();

    const assigned = await em.find(Allocation, { serverId: server.id });
    const free = await em.find(Allocation, { nodeId: server.nodeId, serverId: null });
    const byPort = (a: { port: number }, b: { port: number }) => a.port - b.port;

    return {
      allocations: assigned.sort(byPort).map(allocationDto),
      free: free.sort(byPort).map(allocationDto),
    };
  });

/** Claims a FREE allocation of the server's node and assigns it to the server. */
export const addServerAllocationFn = createServerFn({ method: 'POST' })
  .validator(serverAllocationActionSchema)
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

    if (!hadPrimary) await pushPrimaryAllocation(em, server);
    return { id: allocation.id };
  });

/**
 * Releases a non-primary allocation — it returns to the node's free pool.
 * The primary must be moved first (refuse otherwise, like Pelican).
 */
export const removeServerAllocationFn = createServerFn({ method: 'POST' })
  .validator(serverAllocationActionSchema)
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

    await pushPrimaryAllocation(em, server);
    return { id: allocation.id };
  });
