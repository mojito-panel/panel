import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import websocket from '@fastify/websocket';
import { createHash, timingSafeEqual } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import type { AgentConfig } from '../config';
import {
  installServerRequestSchema,
  pluginSchema,
  serverActionRequestSchema,
  sendCommandRequestSchema,
  type HealthResponse,
} from '@mojito/contract';
import { runInstall } from '../runner';
import { buildSystemVariables } from '../process/system-vars';
import { ProcessRegistry, PowerActionError } from '../process/registry';
import { ServerStore } from '../process/store';
import { toPanelStatus } from '../process/states';
import { registerConsoleWs } from './console-ws';

const startTime = Date.now();

/** Browser console WS route — authenticated by console JWT, NOT by the panel token. */
const CONSOLE_WS_PATH = /^\/servers\/[^/]+\/ws$/;

/**
 * The console JWT travels in the query string — redact it from every log line.
 */
function redactTokenFromUrl(url: string): string {
  return url.replace(/([?&])token=[^&]*/g, '$1token=[redacted]');
}

/**
 * SHA-256 hash of the token for constant-time comparison.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Verifies the request Bearer token in constant time.
 */
function isAuthorized(request: FastifyRequest, expectedTokenHash: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice(7);
  const tokenHash = hashToken(token);
  const a = Buffer.from(tokenHash, 'hex');
  const b = Buffer.from(expectedTokenHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Maps registry errors to HTTP responses. */
function powerErrorReply(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof PowerActionError) {
    const code = err.code === 'not_found' ? 404 : 409;
    return reply.code(code).send({ error: err.message, code: err.code });
  }
  return reply.code(500).send({ error: 'Erreur interne' });
}

/**
 * Builds the agent's Fastify instance.
 * - /health is public (healthcheck)
 * - All other routes require `Authorization: Bearer <token>`
 */
export function createAgentServer(config: AgentConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: 'info',
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: redactTokenFromUrl(request.url),
            remoteAddress: request.ip,
          };
        },
      },
    },
  });
  const expectedTokenHash = hashToken(config.token);

  const store = new ServerStore(config.dataDir);
  const registry = new ProcessRegistry({ store });

  // ─── Browser console WS (JWT auth, log streaming, commands, power) ──────
  // Own scope: the websocket plugin must be booted BEFORE the
  // `{ websocket: true }` route is registered.
  app.register(async (instance) => {
    await instance.register(websocket);
    registerConsoleWs(instance, { config, registry });
  });

  // ─── Healthcheck (public) ──────────────────────────────────────────────────
  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      version: config.version,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  // ─── Authentication hook (except /health and the console WS) ────────────
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/health') return;
    if (CONSOLE_WS_PATH.test(request.url.split('?')[0])) return; // console JWT, not panel token
    if (!isAuthorized(request, expectedTokenHash)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // ─── Server install (plugin step runner) ─────────────────
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

  // ─── List of installed servers ──────────────────────────────────────────
  app.get('/servers', async () => {
    const stored = await store.list();
    return {
      servers: stored.map((s) => ({
        serverId: s.serverId,
        name: s.name,
        status: toPanelStatus(registry.getState(s.serverId), false),
      })),
    };
  });

  // ─── Server info (actual runtime state + recent logs) ───────────────────
  app.get<{ Params: { serverId: string } }>('/servers/:serverId', async (request, reply) => {
    const stored = await store.get(request.params.serverId);
    if (!stored) {
      return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
    }

    const state = registry.getState(request.params.serverId);
    return {
      serverId: stored.serverId,
      name: stored.name,
      status: toPanelStatus(state, false),
      runtimeState: state,
      pid: null, // metrics in phase 2
      ramMb: null,
      cpuPercent: null,
      startedAt: null,
      logs: registry.getLogs(request.params.serverId).slice(-50),
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
        await registry.handlePowerAction(parsed.data.serverId, parsed.data.action);
        return {
          serverId: parsed.data.serverId,
          action: parsed.data.action,
          status: toPanelStatus(registry.getState(parsed.data.serverId), false),
        };
      } catch (err) {
        return powerErrorReply(err, reply);
      }
    },
  );

  // ─── Incremental logs (panel live console) ─────────────────────────────
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
    const { lines, next } = registry.getLogsAfter(serverId, after);

    return {
      serverId,
      lines,
      next,
      status: toPanelStatus(registry.getState(serverId), false),
      runtimeState: registry.getState(serverId),
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
      if (registry.isRunning(serverId)) {
        return reply.code(409).send({
          error: 'Le serveur est en cours d’exécution',
          code: 'already_running',
        });
      }

      registry.forget(serverId);
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
        const sent = await registry.sendCommand(parsed.data.serverId, parsed.data.command);
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

  return app;
}
