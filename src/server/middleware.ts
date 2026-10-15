import { createMiddleware } from '@tanstack/react-start';
import { runWithOrmContext } from './orm';

/**
 * Server-function middleware: runs the handler inside one MikroORM request
 * context — a single request-scoped EntityManager fork shared by every
 * `orm.em.*` call of the request (one identity map, one unit of work).
 *
 * Attach to EVERY server function that touches the database:
 *
 * ```ts
 * export const getMembersFn = createServerFn({ method: 'GET' })
 *   .middleware([withOrmContext])
 *   .handler(async () => orm.em.find(Member, {}));
 * ```
 *
 * Idempotent: an already-active context is reused, so services called from
 * other contexts (SFTP auth, better-auth hooks) can safely call functions
 * wrapped by this middleware.
 */
export const withOrmContext = createMiddleware().server(({ next }) =>
  runWithOrmContext(next),
);
