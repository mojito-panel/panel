import { createServerFn } from '@tanstack/react-start';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';

/**
 * Healthcheck server function — checks the DB connection (MikroORM).
 */
export const healthCheck = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    const isConnected = await orm.em.getConnection().execute('SELECT 1');
    return {
      status: 'ok' as const,
      db: isConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  });
