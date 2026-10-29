import { createServerFn } from '@tanstack/react-start';
import { requirePanelPermission } from '../session';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import { JOB_STATES, adminJobsList } from '~/lists/jobs';

/**
 * Jobs dashboard (admin) — read-only views over pg-boss's own `job` table
 * (`pgboss` schema, partitioned by queue name). No pg-boss API dependency:
 * the queries are plain SELECTs, the panel never writes there.
 */

/** The columns the jobs table may sort on — allowlist mapped to SQL. */
const SORT_COLUMNS: Record<string, string> = {
  id: 'id',
  name: 'name',
  state: 'state',
  retryCount: 'retry_count',
  startAfter: 'start_after',
  startedOn: 'started_on',
  completedOn: 'completed_on',
  createdOn: 'created_on',
};

/** Counts of jobs per state (created/retry/active/completed/cancelled/failed). */
export const getJobStatsFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    await requirePanelPermission({ 'panel.overview': ['read'] });
    const rows = await orm.em.execute(
      `SELECT state::text AS state, count(*)::int AS count FROM pgboss.job GROUP BY state`,
    );
    const stats: Record<string, number> = {};
    for (const row of rows) {
      stats[row.state] = Number(row.count);
    }
    return stats;
  });

/** pg returns timestamptz sometimes as a Date, sometimes as a string depending on the query path. */
function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Jobs of the pg-boss `job` table — filter/sort/pagination run in the database. */
export const listJobsFn = createServerFn({ method: 'POST' })
  .validator(adminJobsList.querySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.overview': ['read'] });

    // `name` is the only user-input value — bound as a parameter. States are
    // allowlisted against JOB_STATES, LIMIT/OFFSET are server-computed
    // integers: all three are safe to inline.
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (data.name) {
      params.push(`%${data.name}%`);
      conditions.push(`name ILIKE ?`);
    }
    if (typeof data.state === 'string' && data.state !== '') {
      const states = (data.state as string)
        .split(',')
        .filter((state) => (JOB_STATES as readonly string[]).includes(state));
      if (states.length) {
        conditions.push(`state IN (${states.map((state) => `'${state}'`).join(', ')})`);
      }
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sortColumn = SORT_COLUMNS[data.sort ?? 'createdOn'] ?? 'created_on';
    const dir = data.dir === 'asc' ? 'ASC' : 'DESC';
    const pageSize = data.size ?? 25;
    const offset = ((data.page ?? 1) - 1) * pageSize;

    const rows = await orm.em.execute(
      `SELECT id, name, state, retry_count, retry_limit, start_after, created_on, started_on, completed_on, output::text AS output, data::text AS data
       FROM pgboss.job ${where} ORDER BY ${sortColumn} ${dir}, id LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );

    const [{ count }] = await orm.em.execute(
      `SELECT count(*)::int AS count FROM pgboss.job ${where}`,
      params,
    );

    return {
      rowCount: count,
      rows: rows.map((job) => ({
        id: job.id,
        name: job.name,
        state: job.state,
        retryCount: job.retry_count,
        retryLimit: job.retry_limit,
        startAfter: toIsoOrNull(job.start_after),
        createdOn: toIsoOrNull(job.created_on),
        startedOn: toIsoOrNull(job.started_on),
        completedOn: toIsoOrNull(job.completed_on),
        output: job.output ? JSON.stringify(job.output) : null,
        // `data::text` — the raw job payload as JSON text (the list module
        // renders it as a string, like `output`).
        data: job.data || null,
      })),
    };
  });
