import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AgentConfig } from '../config';
import type { HealthResponse } from '@mojito/contract';

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

  // ─── Liste des serveurs (stub V1) ──────────────────────────────────────────
  app.get('/servers', async () => {
    return { servers: [] };
  });

  // ─── Info d'un serveur (stub V1) ───────────────────────────────────────────
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
