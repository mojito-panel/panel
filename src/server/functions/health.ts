import { createServerFn } from '@tanstack/react-start';
import { getOrm } from '~/db';

/**
 * Healthcheck server function — checks the DB connection (MikroORM).
 */
export const healthCheck = createServerFn({ method: 'GET' }).handler(async () => {
  const orm = getOrm();
  const isConnected = await orm.em.getConnection().execute('SELECT 1');
  return {
    status: 'ok' as const,
    db: isConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  };
});
