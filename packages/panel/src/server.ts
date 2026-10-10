import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { initOrm } from '~/db';

/**
 * Custom server entrypoint — TanStack Start detects src/server.ts automatically.
 * At startup: Postgres connection + MikroORM migrations (business entities).
 * The better-auth tables (user/session/account/verification) are managed
 * separately by `npm run auth:migrate` (better-auth CLI).
 */
const orm = await initOrm();
await orm.migrator.up();
console.log('[bootstrap] MikroORM migrations OK');

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
