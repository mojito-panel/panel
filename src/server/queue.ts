import '@tanstack/react-start/server-only';
import { PgBoss } from 'pg-boss';

/**
 * pg-boss queue singleton (server-only) — the panel's durable job runner.
 *
 * pg-boss owns its OWN Postgres schema (`pgboss`, default) and manages it
 * with its own internal migrations on `start()`: its tables are an
 * implementation detail of the engine and are NEVER mapped as MikroORM
 * entities. That separation is what keeps the MikroORM migration generator
 * (a diff of the `public` schema) from emitting drops for tables it does
 * not know — pg-boss internals also change shape between major versions.
 *
 * The panel never uses pg-boss's own cron scheduler (`schedule: false`):
 * WHEN a schedule fires is owned by the `schedule` table (Pelican
 * semantics), computed with croner and scanned by the runner in
 * `src/server/schedules.ts`. pg-boss only carries the durable task chain.
 */

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

let queue: PgBoss | null = null;
let started: Promise<PgBoss> | null = null;

/** Returns (and lazily constructs) the pg-boss singleton. */
export function getQueue(): PgBoss {
  if (!queue) {
    queue = new PgBoss({
      connectionString: databaseUrl,
      schema: 'pgboss',
      application_name: 'mojito-panel',
      // Our schedule table owns the WHEN — pg-boss's cron scheduler is unused.
      schedule: false,
    });
    // An unhandled 'error' event on an EventEmitter crashes the process —
    // pg-boss emits connection/worker failures there.
    queue.on('error', (err) => console.error('[queue] pg-boss error:', err));
    queue.on('warning', (warning) => console.warn('[queue] pg-boss warning:', warning));
  }
  return queue;
}

/**
 * Starts the queue (idempotent): installs/updates the `pgboss` schema and
 * begins its maintenance passes. Called from `src/server.ts` at boot,
 * AFTER the MikroORM migrations — pg-boss creates its own schema.
 */
export function startQueue(): Promise<PgBoss> {
  // Reuse the in-flight/finished promise: a module re-evaluation (SSR
  // reload in dev) must not start a second instance on top of the first.
  started ??= getQueue().start().then((boss) => {
    console.log('[bootstrap] pg-boss queue started (schema "pgboss")');
    return boss;
  });
  return started;
}
