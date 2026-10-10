import { createServerFn } from '@tanstack/react-start';
import { randomUUID } from 'node:crypto';
import { initOrm } from '~/db';
import { Node, Plugin, Server, ServerAllocation } from '~/db/entities';
import type { Plugin as PluginContract } from '@mojito/contract';
import { requireUser, HttpError } from '../session';
import { signConsoleToken } from '../jwt';
import { decryptSecret } from '../crypto';
import {
  agentInstallServer,
  agentGetServer,
  agentGetServerLogs,
  agentGetInstallStatus,
  agentServerAction,
  agentSendCommand,
  agentDeleteServer,
  agentReinstallServer,
  AgentError,
} from '../agent/client';
import {
  createServerSchema,
  serverActionInputSchema,
  sendCommandSchema,
  serverLogsQuerySchema,
} from '~/validators/server';

type ServerStatusDb =
  | 'installing'
  | 'install_failed'
  | 'stopped'
  | 'running'
  | 'crashed';

/** Loads a server + checks ownership (admin = access to everything). */
async function loadOwnedServer(serverId: string, userId: string, isAdmin: boolean) {
  const orm = await initOrm();
  const em = orm.em.fork();
  const server = await em.findOne(Server, { id: serverId });
  if (!server) {
    throw new HttpError(404, 'Serveur introuvable');
  }
  if (!isAdmin && server.ownerId !== userId) {
    throw new HttpError(403, 'Ce serveur ne t’appartient pas');
  }
  return { em, server };
}

// ─── List ─────────────────────────────────────────────────────────────────────

export const listServersFn = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser();
  const orm = await initOrm();
  const em = orm.em.fork();

  const servers = await em.find(
    Server,
    user.role === 'admin' ? {} : { ownerId: user.id },
  );
  const nodes = await em.find(Node, {});
  const plugins = await em.find(Plugin, {});

  return servers.map((server) => ({
    id: server.id,
    name: server.name,
    status: server.status,
    nodeId: server.nodeId,
    nodeName: nodes.find((n) => n.id === server.nodeId)?.name ?? '—',
    pluginId: server.pluginId,
    pluginName: plugins.find((p) => p.id === server.pluginId)?.name ?? '—',
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

    const plugin = await em.findOne(Plugin, { id: data.pluginId });
    if (!plugin) throw new HttpError(404, 'Plugin introuvable');

    const serverId = randomUUID();
    const now = new Date();

    // 1. Persist FIRST with status 'installing' — the user is redirected to
    //    the server console right away and follows the install live.
    const server = em.create(Server, {
      id: serverId,
      name: data.name,
      nodeId: data.nodeId,
      pluginId: data.pluginId,
      ownerId: user.id,
      status: 'installing',
      variables: data.variables,
      createdAt: now,
      updatedAt: now,
    });
    em.persist(server);

    const allocation = em.create(ServerAllocation, {
      id: randomUUID(),
      serverId,
      port: data.port,
      maxRamMb: data.memoryMb,
      maxCpuPercent: 100,
      createdAt: now,
    });
    em.persist(allocation);
    await em.flush();

    // 2. Start the background install on the agent (fast — the agent only
    //    validates, then runs the runner async and records every step).
    // installDir relative to the agent's dataDir.
    try {
      await agentInstallServer(node, {
        serverId,
        name: data.name,
        plugin: plugin.json,
        variables: data.variables,
        installDir: `servers/${serverId}`,
        allocation: { port: data.port, memoryMb: data.memoryMb },
      });
    } catch (err) {
      // The install could not even start → remove the rows and report
      const em2 = orm.em.fork();
      const dbAllocation = await em2.findOne(ServerAllocation, { serverId });
      if (dbAllocation) em2.remove(dbAllocation);
      const dbServer = await em2.findOne(Server, { id: serverId });
      if (dbServer) em2.remove(dbServer);
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
    const { em, server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
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
    const { em, server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
    );

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    const plugin = await em.findOne(Plugin, { id: server.pluginId });
    if (!plugin) throw new HttpError(500, 'Plugin introuvable');

    const allocation = await em.findOne(ServerAllocation, { serverId: server.id });
    if (!allocation) throw new HttpError(500, 'Allocation introuvable');

    try {
      await agentInstallServer(node, {
        serverId: server.id,
        name: server.name,
        plugin: plugin.json,
        variables: server.variables,
        installDir: `servers/${server.id}`,
        allocation: { port: allocation.port, memoryMb: allocation.maxRamMb },
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
    const { server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
    );
    const orm = await initOrm();
    const em = orm.em.fork();

    const node = await em.findOne(Node, { id: server.nodeId });
    const plugin = await em.findOne(Plugin, { id: server.pluginId });
    const allocation = await em.findOne(ServerAllocation, { serverId: server.id });

    if (!node || !plugin) {
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

    const pluginJson = plugin.json as PluginContract;

    return {
      id: server.id,
      name: server.name,
      status: runtimeStatus,
      runtimeState,
      ownerId: server.ownerId,
      variables: server.variables,
      createdAt: server.createdAt,
      node: { id: node.id, name: node.name, fqdn: node.fqdn },
      plugin: {
        id: plugin.id,
        name: plugin.name,
        slug: plugin.slug,
        // Variable definitions for the UI (forms)
        variables: pluginJson.variables ?? [],
        start: pluginJson.start,
      },
      allocation: allocation
        ? { port: allocation.port, memoryMb: allocation.maxRamMb }
        : null,
      logs,
    };
  });

// ─── Power action (start/stop/restart/kill) ───────────────────────────────────

export const serverActionFn = createServerFn({ method: 'POST' })
  .validator(serverActionInputSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
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

// ─── Reinstall (stop + re-run the plugin's install script) ────────────────────

export const reinstallServerFn = createServerFn({ method: 'POST' })
  .validator(serverLogsQuerySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
    );

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    // The CURRENT plugin is sent — an update of the plugin JSON is picked up
    // on reinstall, like an egg update in Pelican.
    const plugin = await em.findOne(Plugin, { id: server.pluginId });
    if (!plugin) throw new HttpError(500, 'Plugin introuvable');

    try {
      const result = await agentReinstallServer(node, server.id, {
        plugin: plugin.json,
        variables: server.variables,
      });
      // The reinstall now runs in the background — the console shows the
      // live install panel (steps + logs) while it goes
      server.status = 'installing';
      await em.flush();
      return { id: server.id, status: 'installing', message: result.message };
    } catch (err) {
      if (err instanceof AgentError) {
        throw new HttpError(502, `Réinstallation refusée côté agent : ${err.message}`);
      }
      throw err;
    }
  });

// ─── Console command ──────────────────────────────────────────────────────────

export const sendCommandFn = createServerFn({ method: 'POST' })
  .validator(sendCommandSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
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
    const { server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
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
    const { server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
    );
    const orm = await initOrm();
    const em = orm.em.fork();
    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    // Short-lived JWT — the agent validates signature/aud/scope/exp/serverId
    // and gates every console action on the permissions carried in the payload.
    // Pelican-style: signed with the node's OWN agent token (single per-node
    // secret). V1: no invitations — owner/admin gets every permission.
    const { token } = signConsoleToken(
      { userId: user.id, serverId: server.id },
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
    const { em, server } = await loadOwnedServer(
      data.serverId,
      user.id,
      user.role === 'admin',
    );

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

    // DB deletion (server + allocation)
    const allocation = await em.findOne(ServerAllocation, { serverId: server.id });
    if (allocation) em.remove(allocation);
    em.remove(server);
    await em.flush();

    return { deleted: true };
  });
