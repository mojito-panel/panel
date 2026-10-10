import type { FastifyInstance, FastifyReply } from 'fastify';
import { rm } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import {
  installServerRequestSchema,
  pluginSchema,
  reinstallServerRequestSchema,
  serverActionRequestSchema,
  sendCommandRequestSchema,
} from '@mojito/contract';
import type { AgentConfig } from '../config';
import { ServerManager, PowerActionError } from '../server/manager';
import { runInstall } from '../server/installer';
import { buildSystemVariables } from '../server/variables';
import { toPanelStatus } from '../environment/states';
import type { ServerStore } from '../internal/server-store';

export interface ServerRoutesOptions {
  config: AgentConfig;
  manager: ServerManager;
  store: ServerStore;
}

/** Maps server errors to HTTP responses. */
function powerErrorReply(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof PowerActionError) {
    const code = err.code === 'not_found' ? 404 : 409;
    return reply.code(code).send({ error: err.message, code: err.code });
  }
  return reply.code(500).send({ error: 'Erreur interne' });
}

/** Server routes (≈ wings router_server.go). All behind the panel token. */
export function registerServerRoutes(app: FastifyInstance, options: ServerRoutesOptions): void {
  const { config, manager, store } = options;

  // ─── Server install (plugin step runner) ───────────────────────────────
  app.post('/servers/install', async (request, reply) => {
    const parsed = installServerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Requête invalide',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const pluginResult = pluginSchema.safeParse(parsed.data.plugin);
    if (!pluginResult.success) {
      return reply.code(400).send({
        error: 'Plugin invalide',
        details: pluginResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    // installDir: used as-is when absolute, otherwise resolved under the agent's dataDir
    // (the panel typically sends "servers/<uuid>" — this guarantees DELETE
    // can remove the folder within our scope)
    const rawInstallDir = parsed.data.installDir;
    const installDir = isAbsolute(rawInstallDir)
      ? rawInstallDir
      : resolve(config.dataDir, rawInstallDir);

    const result = await runInstall({
      plugin: pluginResult.data,
      variables: parsed.data.variables,
      systemVariables: buildSystemVariables(
        parsed.data.serverId,
        parsed.data.name,
        installDir,
        parsed.data.allocation,
      ),
      installDir,
      // Real-time progress via WS: phase 3. For now the call is synchronous.
    });

    if (!result.success) {
      return reply.code(422).send({ error: result.error });
    }

    // Persist the installed server → start only needs the serverId
    await store.save({
      serverId: parsed.data.serverId,
      name: parsed.data.name,
      plugin: pluginResult.data,
      variables: parsed.data.variables,
      installDir,
      allocation: parsed.data.allocation,
      installedAt: new Date().toISOString(),
    });

    return {
      serverId: parsed.data.serverId,
      status: 'stopped',
      message: 'Installation terminée',
    };
  });

  // ─── Server reinstall (re-run the plugin's install script in place) ────
  app.post<{ Params: { serverId: string } }>(
    '/servers/:serverId/reinstall',
    async (request, reply) => {
      const parsed = reinstallServerRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      // Fresh plugin from the panel (an update may have changed the script)
      const pluginResult = pluginSchema.safeParse(parsed.data.plugin);
      if (!pluginResult.success) {
        return reply.code(400).send({
          error: 'Plugin invalide',
          details: pluginResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const stored = await store.get(parsed.data.serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }

      // Pelican semantics: reinstall stops the server first
      if (manager.isRunning(parsed.data.serverId)) {
        try {
          await manager.handlePowerAction(parsed.data.serverId, 'stop');
        } catch (err) {
          return powerErrorReply(err, reply);
        }
      }

      // Re-run the install runner in the SAME directory with the SAME
      // allocation (stored) but the LATEST plugin/variables
      const result = await runInstall({
        plugin: pluginResult.data,
        variables: parsed.data.variables,
        systemVariables: buildSystemVariables(
          stored.serverId,
          stored.name,
          stored.installDir,
          stored.allocation,
        ),
        installDir: stored.installDir,
      });

      if (!result.success) {
        return reply.code(422).send({ error: result.error });
      }

      await store.save({
        ...stored,
        plugin: pluginResult.data,
        variables: parsed.data.variables,
        installedAt: new Date().toISOString(),
      });

      return {
        serverId: parsed.data.serverId,
        status: 'stopped',
        message: 'Réinstallation terminée',
      };
    },
  );

  // ─── List of installed servers ──────────────────────────────────────────
  app.get('/servers', async () => {
    const stored = await store.list();
    return {
      servers: stored.map((s) => ({
        serverId: s.serverId,
        name: s.name,
        status: toPanelStatus(manager.getState(s.serverId), false),
      })),
    };
  });

  // ─── Server info (actual runtime state + recent logs) ───────────────────
  app.get<{ Params: { serverId: string } }>('/servers/:serverId', async (request, reply) => {
    const stored = await store.get(request.params.serverId);
    if (!stored) {
      return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
    }

    const state = manager.getState(request.params.serverId);
    return {
      serverId: stored.serverId,
      name: stored.name,
      status: toPanelStatus(state, false),
      runtimeState: state,
      pid: null, // metrics in phase 2
      ramMb: null,
      cpuPercent: null,
      startedAt: null,
      logs: manager.getLogs(request.params.serverId).slice(-50),
    };
  });

  // ─── Power action (start/stop/restart/kill) ────────────────────────────────
  app.post<{ Params: { serverId: string } }>(
    '/servers/:serverId/action',
    async (request, reply) => {
      const parsed = serverActionRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      try {
        await manager.handlePowerAction(parsed.data.serverId, parsed.data.action);
        return {
          serverId: parsed.data.serverId,
          action: parsed.data.action,
          status: toPanelStatus(manager.getState(parsed.data.serverId), false),
        };
      } catch (err) {
        return powerErrorReply(err, reply);
      }
    },
  );

  // ─── Incremental logs (panel live console fallback) ─────────────────────
  app.get<{
    Params: { serverId: string };
    Querystring: { after?: string };
  }>('/servers/:serverId/logs', async (request, reply) => {
    const { serverId } = request.params;
    const stored = await store.get(serverId);
    if (!stored) {
      return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
    }

    const after = Math.max(0, Number(request.query.after ?? 0) || 0);
    const { lines, next } = manager.getLogsAfter(serverId, after);

    return {
      serverId,
      lines,
      next,
      status: toPanelStatus(manager.getState(serverId), false),
      runtimeState: manager.getState(serverId),
    };
  });

  // ─── Server deletion (full cleanup) ────────────────────────────
  app.delete<{ Params: { serverId: string } }>(
    '/servers/:serverId',
    async (request, reply) => {
      const { serverId } = request.params;
      const stored = await store.get(serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }

      // Refuse while the process runs — the panel must stop/kill first
      if (manager.isRunning(serverId)) {
        return reply.code(409).send({
          error: 'Le serveur est en cours d’exécution',
          code: 'already_running',
        });
      }

      manager.forget(serverId);
      await store.delete(serverId);

      // Folder removal — only if it is under the agent's dataDir
      // (guard against accidental deletion of a path outside our scope)
      const normalizedDataDir = resolve(config.dataDir);
      const normalizedInstallDir = resolve(stored.installDir);
      let removed = false;
      if (
        normalizedInstallDir === normalizedDataDir ||
        normalizedInstallDir.startsWith(normalizedDataDir + sep)
      ) {
        await rm(stored.installDir, { recursive: true, force: true });
        removed = true;
      }

      return { serverId, removed, installDir: stored.installDir };
    },
  );

  // ─── Console command (stdin) ───────────────────────────────────────────────
  app.post<{ Params: { serverId: string } }>(
    '/servers/:serverId/command',
    async (request, reply) => {
      const parsed = sendCommandRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      try {
        const sent = await manager.sendCommand(parsed.data.serverId, parsed.data.command);
        if (!sent) {
          return reply.code(409).send({
            error: 'Le serveur n’est pas en cours d’exécution',
            code: 'not_running',
          });
        }
        return { serverId: parsed.data.serverId, sent: true };
      } catch (err) {
        return powerErrorReply(err, reply);
      }
    },
  );
}
