import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AgentConfig } from '../config';
import {
  installServerRequestSchema,
  pluginSchema,
  serverAllocationSchema,
  type HealthResponse,
  type InstallServerRequest,
} from '@mojito/contract';
import { runInstall } from '../runner';
import type { SystemVariables } from '../runner/templating';

const startTime = Date.now();

/**
 * Hash SHA-256 du token pour comparaison en temps constant.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Vérifie le Bearer token de la requête en temps constant.
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

/**
 * Construit les variables système de l'agent depuis la requête d'installation.
 */
function buildSystemVariables(request: InstallServerRequest): SystemVariables {
  return {
    SERVER_UUID: request.serverId,
    SERVER_NAME: request.name,
    SERVER_MEMORY: request.allocation.memoryMb,
    SERVER_PORT: request.allocation.port,
    SERVER_IP: request.allocation.ip,
    SERVER_INSTALL_DIR: request.installDir,
  };
}

/**
 * Construit l'instance Fastify de l'agent.
 * - /health est public (healthcheck)
 * - Toutes les autres routes nécessitent `Authorization: Bearer <token>`
 */
export function createAgentServer(config: AgentConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  const expectedTokenHash = hashToken(config.token);

  // ─── Healthcheck (public) ──────────────────────────────────────────────────
  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      version: config.version,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  // ─── Hook d'authentification (sauf /health) ────────────────────────────────
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/health') return;
    if (!isAuthorized(request, expectedTokenHash)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // ─── Installation d'un serveur (runner d'étapes du plugin) ─────────────────
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

    const result = await runInstall({
      plugin: pluginResult.data,
      variables: parsed.data.variables,
      systemVariables: buildSystemVariables(parsed.data),
      installDir: parsed.data.installDir,
      // Progression temps réel via WS : phase 3. Pour l'instant, l'appel est synchrone.
    });

    if (!result.success) {
      return reply.code(422).send({ error: result.error });
    }

    return {
      serverId: parsed.data.serverId,
      status: 'stopped',
      message: 'Installation terminée',
    };
  });

  // ─── Liste des serveurs (stub — persistance en phase 3) ────────────────────
  app.get('/servers', async () => {
    return { servers: [] };
  });

  // ─── Info d'un serveur (stub — process manager en phase 1) ─────────────────
  app.get<{ Params: { serverId: string } }>('/servers/:serverId', async (request) => {
    return {
      serverId: request.params.serverId,
      status: 'stopped',
      pid: null,
      ramMb: null,
      cpuPercent: null,
      startedAt: null,
    };
  });

  return app;
}

export { serverAllocationSchema };
