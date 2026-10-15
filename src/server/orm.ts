import '@tanstack/react-start/server-only';
import { RequestContext } from '@mikro-orm/core';
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql';
import { initOrm } from '~/db';

/**
 * ORM request-context module (server-only).
 *
 * Every DB access runs inside a MikroORM `RequestContext`: ONE
 * request-scoped EntityManager fork shared by every `orm.em.*` call of the
 * request — a single identity map and unit of work. Outside a context the
 * global EM refuses context-specific actions (MikroORM's
 * `allowGlobalContext: false`), so a forgotten context fails loudly
 * instead of silently forking. NEVER call `orm.em.fork()` manually: it
 * splits the identity map (the anti-pattern this module removes).
 */

/** The initialized ORM singleton (its `em` resolves the request fork). */
export const orm = await initOrm();


/**
 * Runs `fn` inside one MikroORM request context (one shared request-scoped
 * EM fork for everything `fn` does). Reuses an existing context when one
 * is already active — safe to nest (e.g. an SFTP auth flow that calls a
 * session helper already wrapped by `withOrmContext` upstream).
 */
export function runWithOrmContext<T>(fn: () => T): T {
  if (RequestContext.currentRequestContext()) return fn();
  return RequestContext.create(orm.em, fn);
}
