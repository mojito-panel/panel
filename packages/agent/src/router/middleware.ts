import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Panel token authentication (≈ wings router/middleware.go).
 * - /health is public (healthcheck)
 * - the console WS route authenticates via its own console JWT
 * - every other route requires `Authorization: Bearer <token>` in constant time
 */

/** Browser console WS route — authenticated by console JWT, NOT by the panel token. */
export const CONSOLE_WS_PATH = /^\/servers\/[^/]+\/ws$/;

/** SHA-256 hash of the token for constant-time comparison. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Verifies the request Bearer token in constant time. */
export function isAuthorized(request: FastifyRequest, expectedTokenHash: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice(7);
  const tokenHash = hashToken(token);
  const a = Buffer.from(tokenHash, 'hex');
  const b = Buffer.from(expectedTokenHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Registers the onRequest auth hook (exceptions: /health, console WS). */
export function registerAuthenticationHook(app: FastifyInstance, expectedTokenHash: string): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url === '/health') return;
    if (CONSOLE_WS_PATH.test(request.url.split('?')[0])) return; // console JWT, not panel token
    if (!isAuthorized(request, expectedTokenHash)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
}
