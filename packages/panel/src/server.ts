import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { initOrm } from '~/db';

/**
 * Entrypoint serveur custom — TanStack Start détecte automatiquement src/server.ts.
 * Au démarrage : connexion Postgres + migrations MikroORM (entités métier).
 * Les tables better-auth (user/session/account/verification) sont gérées
 * séparément par `npm run auth:migrate` (CLI better-auth).
 */
const orm = await initOrm();
await orm.migrator.up();
console.log('[bootstrap] MikroORM migrations OK');

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
