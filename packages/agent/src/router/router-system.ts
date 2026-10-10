import type { FastifyInstance } from 'fastify';
import type { HealthResponse, NodeStats } from '@mojito/contract';
import type { AgentConfig } from '../config';
import type { SystemStatsCollector } from '../system/stats';

const startTime = Date.now();

export interface SystemRoutesOptions {
  config: AgentConfig;
  /** Node system metrics (REST snapshot; the health WS pushes them live). */
  collector: SystemStatsCollector;
}

/** System routes (≈ wings router_system.go): public healthcheck + stats. */
export function registerSystemRoutes(app: FastifyInstance, options: SystemRoutesOptions): void {
  const { config, collector } = options;

  app.get('/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      version: config.version,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  // Panel-facing snapshot — the panel measures its round-trip as node latency
  app.get('/stats', async (): Promise<NodeStats> => collector.sample());
}
