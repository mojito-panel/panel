import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/core';
import { initOrm } from '~/db';
import { Node, Recipe, Server, Allocation, ServerUser, Backup } from '~/db/entities';
import { userServersList } from '~/lists/user-servers';
import { serverAllocationsList } from '~/lists/allocations';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import { resolveRuntimeRecipes } from './runtimes';
import { normalizeStoredRecipe } from '~/lib/stored-recipe';
import { nanoid } from '~/lib/nanoid';
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
  serverDetailQuerySchema,
  serverLogsQuerySchema,
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

/**
 * Visibility scope of the viewer on the server table: an admin sees every
 * server, anyone else the ones they own PLUS the ones shared with them through
 * a `server_user` grant (Pelican sub-user semantics). `null` = no restriction.
 */
async function viewerServerScope(em: EntityManager, user: { id: string; role: string }) {
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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const orm = await initOrm();
    const em = orm.em.fork();

    const qb = listQueryBuilder(em, Server, userServersList);
    const scope = await viewerServerScope(em, user);
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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const orm = await initOrm();
    const em = orm.em.fork();

    const qb = listQueryBuilder(em, Server, userServersList);
    const scope = await viewerServerScope(em, user);
    if (scope) qb.where(scope);
    if (data.nodeId) qb.andWhere({ nodeId: data.nodeId });

    const servers = await qb.orderBy({ name: 'ASC' }).getResult();
    return servers.map((server) => ({ id: server.id, name: server.name }));
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

    const serverId = nanoid();
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
      cpuCores: data.cpuCores,
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
        recipe: normalizeStoredRecipe(recipe.json),
        runtimes: await resolveRuntimeRecipes(em, recipe.json),
        variables: data.variables,
        installDir: `servers/${serverId}`,
        allocation: {
          port: allocation.port,
          memoryMb: data.memoryMb,
          cpuCores: data.cpuCores,
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
        recipe: normalizeStoredRecipe(recipe.json),
        runtimes: await resolveRuntimeRecipes(em, recipe.json),
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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerForViewer(data.serverId, user);
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    try {
      const info = await agentGetServer(node, server.id);
      // Sync the persisted status
      if (info.status !== server.status) {
        const em2 = orm.em.fork();
        const dbServer = await em2.findOne(Server, { id: server.id });
        if (dbServer) {
          dbServer.status = info.status;
          await em2.flush();
        }
      }
      return { status: info.status, runtimeState: info.runtimeState ?? null };
    } catch {
      // Agent unreachable → no live status (null = "Inconnu" in the UI)
      return { status: null, runtimeState: null };
    }
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

    // A suspended server can only be stopped/killed (Pelican semantics) —
    // start/restart are refused until an admin reactivates it.
    if (server.suspended && (data.action === 'start' || data.action === 'restart')) {
      throw new HttpError(409, 'Ce serveur est suspendu — réactivation requise avant tout démarrage');
    }

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
        recipe: normalizeStoredRecipe(recipe.json),
        runtimes: await resolveRuntimeRecipes(em, recipe.json),
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
            runtimes: await resolveRuntimeRecipes(em, recipe.json),
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
      wsUrl: `${isHttpsScheme(node.scheme) ? 'wss' : 'ws'}://${node.fqdn}:${node.publicPort}/servers/${server.id}/ws`,
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
    // The sub-user grants and backup rows die with the server
    const grants = await em.find(ServerUser, { serverId: server.id });
    em.remove(grants);
    const backups = await em.find(Backup, { serverId: server.id });
    em.remove(backups);
    em.remove(server);
    await em.flush();

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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.network': ['read'] },
    );
    const orm = await initOrm();
    const em = orm.em.fork();

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
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.network': ['read'] },
    );
    const orm = await initOrm();
    const em = orm.em.fork();

    const free = await em.find(Allocation, { nodeId: server.nodeId, serverId: null });
    return free.sort((a, b) => a.port - b.port).map(allocationPickerDto);
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
