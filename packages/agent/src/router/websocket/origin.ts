import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AgentConfig } from '../../config';

/**
 * Origin gate shared by the browser-facing websockets (console + health).
 * ≈ wings' websocket upgrader CheckOrigin: a missing or unknown origin
 * (i.e. not the panel / AGENT_ALLOWED_ORIGINS) is rejected with 403
 * BEFORE the socket upgrade — the JWT is not even considered.
 */

/** PreHandler rejecting upgrades whose Origin is not the panel (or an allowed extra). */
export function makeOriginGate(config: AgentConfig): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void> {
  const allowedOrigins = new Set(config.allowedOrigins);
  if (config.panelUrl) allowedOrigins.add(config.panelUrl);

  return async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      return reply.code(403).send({ error: 'Origin non autorisée' });
    }
  };
}
