import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { AgentConfig } from '../config';
import { ServerManager } from '../server/manager';
import { ServerStore } from '../internal/server-store';
import { InstallRegistry } from '../server/installer/registry';
import { SystemStatsCollector } from '../system/stats';
import { registerAuthenticationHook, hashToken } from './middleware';
import { registerSystemRoutes } from './router-system';
import { registerServerRoutes } from './router-server';
import { registerFilesRoutes } from './router-files';
import { registerConsoleWs } from './websocket/websocket';
import { registerHealthWs } from './websocket/health-ws';

/**
 * The console JWT may travel in a query string (legacy clients) —
 * redact it from every log line.
 */
function redactTokenFromUrl(url: string): string {
  return url.replace(/([?&])token=[^&]*/g, '$1token=[redacted]');
}

/**
 * Builds the agent's Fastify instance (≈ wings router/router.go):
 * - system routes: /health public, /stats behind the panel token
 * - server routes: behind `Authorization: Bearer <token>`
 * - browser console WS: console JWT (auth message), origin-gated
 * - browser health WS: health JWT (auth message), origin-gated
 */
export function createAgentServer(config: AgentConfig): FastifyInstance {
  const app = Fastify({
    // File API: uploads (10 Mo decoded ≈ 13.7 Mo base64) and text writes must
    // reach the handlers — the SERVICE enforces the real per-route limits.
    bodyLimit: 32 * 1024 * 1024,
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

  const store = new ServerStore(config.dataDir);
  const manager = new ServerManager({ store });
  const registry = new InstallRegistry();
  const collector = new SystemStatsCollector({
    dataDir: config.dataDir,
    version: config.version,
    countRunning: async () => {
      const stored = await store.list();
      return stored.filter((s) => manager.isRunning(s.serverId)).length;
    },
  });

  // ─── Authentication hook (except /health and the browser WSs) ────────────
  registerAuthenticationHook(app, hashToken(config.token));

  // ─── System routes (public healthcheck + panel-token stats snapshot) ──────
  registerSystemRoutes(app, { config, collector });

  // ─── Server routes (panel token) ─────────────────────────────────────────
  registerServerRoutes(app, { config, manager, store, registry });

  // ─── File browser routes (panel token, sandboxed to installDir) ─────────
  registerFilesRoutes(app, { store });

  // ─── Browser console WS (JWT auth, log streaming, commands, power) ──────
  // Own scope: the websocket plugin must be booted BEFORE the
  // `{ websocket: true }` routes are registered.
  app.register(async (instance) => {
    await instance.register(websocket);
    registerConsoleWs(instance, { config, manager, registry });
    registerHealthWs(instance, { config, collector });
  });

  return app;
}
