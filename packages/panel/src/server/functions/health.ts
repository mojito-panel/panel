import { createServerFn } from '@tanstack/react-start';
import { getOrm } from '~/db';

/**
 * Server function de healthcheck — vérifie la connexion DB (MikroORM).
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
