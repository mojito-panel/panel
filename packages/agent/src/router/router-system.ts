import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@mojito/contract';
import type { AgentConfig } from '../config';

const startTime = Date.now();

/** System routes (≈ wings router_system.go): public healthcheck. */
export function registerSystemRoutes(app: FastifyInstance, config: AgentConfig): void {
  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      version: config.version,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    };
  });
}
