import type { FastifyInstance, FastifyReply } from 'fastify';
import { rm } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import {
  installServerRequestSchema,
  recipeSchema,
  reinstallServerRequestSchema,
  serverActionRequestSchema,
  sendCommandRequestSchema,
  updateServerVariablesRequestSchema,
  updateServerAllocationRequestSchema,
  validateVariableValue,
} from '@mojito/contract';
import type { AgentConfig } from '../config';
import { ServerManager, PowerActionError } from '../server/manager';
import { validateInstall } from '../server/installer';
import { startTrackedInstall } from '../server/installer/tracked';
import type { InstallRegistry } from '../server/installer/registry';
import { toPanelStatus } from '../environment/states';
import type { ServerStore } from '../internal/server-store';
import type { StateStore } from '../internal/state-store';

export interface ServerRoutesOptions {
  config: AgentConfig;
  manager: ServerManager;
  store: ServerStore;
  stateStore: StateStore;
  registry: InstallRegistry;
}

/** Maps server errors to HTTP responses. */
function powerErrorReply(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof PowerActionError) {
    if (err.code === 'not_found') return reply.code(404).send({ error: err.message, code: err.code });
    if (err.code === 'start_failed')
      return reply.code(500).send({ error: err.message, code: err.code });
    return reply.code(409).send({ error: err.message, code: err.code });
  }
  return reply.code(500).send({ error: 'Erreur interne' });
}

/** Server routes (≈ wings router_server.go). All behind the panel token. */
export function registerServerRoutes(app: FastifyInstance, options: ServerRoutesOptions): void {
  const { config, manager, store, stateStore, registry } = options;

  // ─── Server install (background, tracked step by step) ────────────────
  app.post('/servers/install', async (request, reply) => {
    const parsed = installServerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Requête invalide',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const recipeResult = recipeSchema.safeParse(parsed.data.recipe);
    if (!recipeResult.success) {
      return reply.code(400).send({
        error: 'Recette invalide',
        details: recipeResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    // Upfront validation (unknown variables, invalid values) — the panel
    // gets an immediate 422 instead of a delayed background failure
    const validationError = validateInstall(recipeResult.data, parsed.data.variables);
    if (validationError) {
      return reply.code(422).send({ error: validationError });
    }

    // installDir: used as-is when absolute, otherwise resolved under the agent's dataDir
    // (the panel typically sends "servers/<uuid>" — this guarantees DELETE
    // can remove the folder within our scope)
    const rawInstallDir = parsed.data.installDir;
    const installDir = isAbsolute(rawInstallDir)
      ? rawInstallDir
      : resolve(config.dataDir, rawInstallDir);

    // The install runs IN THE BACKGROUND — every step, command output and
    // error is recorded in the registry; the panel follows via
    // GET /servers/:serverId/install and can retry on failure
    startTrackedInstall({
      registry,
      store,
      serverId: parsed.data.serverId,
      name: parsed.data.name,
      recipe: recipeResult.data,
      variables: parsed.data.variables,
      installDir,
      allocation: parsed.data.allocation,
    });

    return reply.code(202).send({
      serverId: parsed.data.serverId,
      status: 'installing',
      message: 'Installation démarrée',
    });
  });

  // ─── Install status + logs (panel live progress) ───────────────────────
  app.get<{ Params: { serverId: string } }>(
    '/servers/:serverId/install',
    async (request, reply) => {
      const { serverId } = request.params;
      const state = registry.get(serverId);
      if (state) {
        return state;
      }

      // No install ran since the agent started — but the server exists
      const stored = await store.get(serverId);
      if (stored) {
        return {
          serverId,
          status: 'installed' as const,
          step: 0,
          totalSteps: 0,
          percent: 100,
          message: 'Installé',
          error: null,
          logs: [],
          startedAt: null,
          finishedAt: null,
        };
      }

      return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
    },
  );

  // ─── Server reinstall (background: stop + re-run the install script) ───
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

      // Fresh recipe from the panel (an update may have changed the script)
      const recipeResult = recipeSchema.safeParse(parsed.data.recipe);
      if (!recipeResult.success) {
        return reply.code(400).send({
          error: 'Recette invalide',
          details: recipeResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const validationError = validateInstall(recipeResult.data, parsed.data.variables);
      if (validationError) {
        return reply.code(422).send({ error: validationError });
      }

      const stored = await store.get(parsed.data.serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }

      if (registry.isInstalling(parsed.data.serverId)) {
        return reply.code(409).send({
          error: 'Une installation est déjà en cours',
          code: 'already_installing',
        });
      }

      // Background reinstall — Pelican semantics: stops the server first,
      // then re-runs the runner in the SAME directory with the STORED
      // allocation but the LATEST recipe/variables. Follow along via
      // GET /servers/:serverId/install.
      startTrackedInstall({
        registry,
        store,
        serverId: stored.serverId,
        name: stored.name,
        recipe: recipeResult.data,
        variables: parsed.data.variables,
        installDir: stored.installDir,
        allocation: stored.allocation,
        existing: stored,
        before: manager.isRunning(stored.serverId)
          ? () => manager.handlePowerAction(stored.serverId, 'stop')
          : undefined,
      });

      return reply.code(202).send({
        serverId: stored.serverId,
        status: 'installing',
        message: 'Réinstallation démarrée',
      });
    },
  );

  // ─── List of installed servers ──────────────────────────────────────────
  app.get('/servers', async () => {
    const stored = await store.list();
    return {
      servers: stored.map((s) => ({
        serverId: s.serverId,
        name: s.name,
        status: registry.isInstalling(s.serverId)
          ? ('installing' as const)
          : toPanelStatus(manager.getState(s.serverId), false),
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
      status: registry.isInstalling(stored.serverId)
        ? ('installing' as const)
        : toPanelStatus(state, false),
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

  // ─── Variable update (panel "Variables" page) ──────────────────────────
  // The panel sends the FULL variable record; values are validated against
  // the stored recipe definitions. Only the stored entry changes — a
  // running process keeps its original environment until the next start.
  app.post<{ Params: { serverId: string } }>(
    '/servers/:serverId/variables',
    async (request, reply) => {
      const parsed = updateServerVariablesRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const stored = await store.get(parsed.data.serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }

      // An install in flight resolves variables upfront — refuse instead of
      // letting the runner and this update race on the same record
      if (registry.isInstalling(parsed.data.serverId)) {
        return reply.code(409).send({
          error: 'Une installation est en cours',
          code: 'already_installing',
        });
      }

      const variables = { ...stored.variables, ...parsed.data.variables };
      for (const variable of stored.recipe.variables) {
        const value = variables[variable.env];
        if (value !== undefined) {
          const error = validateVariableValue(variable, value);
          if (error) {
            return reply.code(422).send({ error });
          }
        }
      }

      await store.save({ ...stored, variables });
      return { serverId: stored.serverId, variables };
    },
  );

  // ─── Primary allocation update (panel "Network" page) ────────────────────
  // Same push semantics as the variable update: only the stored entry
  // changes — SERVER_PORT / SERVER_IP are re-resolved at the NEXT start,
  // a running process keeps its original environment.
  app.post<{ Params: { serverId: string } }>(
    '/servers/:serverId/allocation',
    async (request, reply) => {
      const parsed = updateServerAllocationRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const stored = await store.get(parsed.data.serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }

      // An install in flight resolves the allocation upfront — refuse
      // instead of letting the runner and this update race
      if (registry.isInstalling(parsed.data.serverId)) {
        return reply.code(409).send({
          error: 'Une installation est en cours',
          code: 'already_installing',
        });
      }

      const allocation = {
        ...stored.allocation,
        port: parsed.data.allocation.port,
        ip: parsed.data.allocation.ip,
      };
      await store.save({ ...stored, allocation });
      return { serverId: stored.serverId, allocation };
    },
  );

  // ─── Server deletion (full cleanup) ────────────────────────────
  app.delete<{ Params: { serverId: string } }>(
    '/servers/:serverId',
    async (request, reply) => {
      const { serverId } = request.params;
      const stored = await store.get(serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }

      // Refuse while an install/reinstall is running — the runner may be
      // writing to the install directory
      if (registry.isInstalling(serverId)) {
        return reply.code(409).send({
          error: 'Une installation est en cours',
          code: 'installing',
        });
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
      // Boot-restore artifact: a stale states.json entry would be ignored at
      // boot, but keeping it around would resurrect a deleted id.
      await stateStore.delete(serverId);

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
