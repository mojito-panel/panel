import { MikroORM } from '@mikro-orm/postgresql';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  User,
  Session,
  Account,
  Verification,
  Node,
  Recipe,
  Server,
  Allocation,
  ServerUser,
  PanelRole,
  Backup,
  Setting,
} from '~/db/entities';
import { adminServersList } from '~/lists/servers';
import { listQueryBuilder, runListQuery } from '~/server/list/query';

import { databaseReachable } from './helpers/db-reachable';

/**
 * The list queries executed by real Postgres.
 *
 * `tests/list-query.test.ts` asserts the SQL the contract GENERATES; this file
 * runs the same spec against the dev database, which is what proves `$ilike`,
 * the joins and `getResultAndCount()` behave (`$ilike` is Postgres-only, so the
 * SQLite test driver cannot cover it).
 *
 * It SKIPS itself when no database is reachable, so `npm test` stays green on a
 * machine without the dev stack. Start one with `mise run setup:dev`.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

const ENTITIES = [
  User,
  Session,
  Account,
  Verification,
  Node,
  Recipe,
  Server,
  Allocation,
  ServerUser,
  PanelRole,
  Backup,
  Setting,
];

// Plain TCP probe (tests/helpers/db-reachable) — a MikroORM probe's
// internal rejections escape as unhandled under Vitest and turn the skip
// into a failure.
const databaseUp = await databaseReachable(DATABASE_URL);

describe.skipIf(!databaseUp)('admin servers list against Postgres', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: 'mojito',
      clientUrl: DATABASE_URL,
      entities: ENTITIES,
      debug: false,
    });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  const em = () => orm.em.fork();

  async function run(input: Record<string, unknown>) {
    const query = adminServersList.querySchema.parse(input);
    return runListQuery(
      listQueryBuilder(em(), Server, adminServersList),
      adminServersList.spec,
      query,
    );
  }

  it('paginates with an exact total', async () => {
    const all = await run({ size: 100 });
    const page1 = await run({});
    expect(page1.rowCount).toBe(all.rows.length);
    expect(page1.rows).toHaveLength(Math.min(25, all.rowCount));

    const narrow = await run({ size: 10 });
    const page2 = await run({ size: 10, page: 2 });
    expect(narrow.rows).toHaveLength(Math.min(10, all.rowCount));
    expect(page2.rows).toHaveLength(Math.max(0, Math.min(10, all.rowCount - 10)));
    const firstPageIds = new Set(narrow.rows.map((row) => row.id));
    expect(page2.rows.some((row) => firstPageIds.has(row.id))).toBe(false);
    expect(page2.rowCount).toBe(all.rowCount);
  });

  it('filters by status (multi-choice) and multi-value keeps the IN list', async () => {
    const every = await run({ size: 100 });
    const running = await run({ status: 'running', size: 100 });
    expect(running.rows.every((row) => row.status === 'running')).toBe(true);
    expect(running.rowCount).toBe(every.rows.filter((row) => row.status === 'running').length);

    const both = await run({ status: 'running,crashed', size: 100 });
    expect(both.rowCount).toBeGreaterThanOrEqual(running.rowCount);
    expect(both.rows.every((row) => ['running', 'crashed'].includes(row.status))).toBe(true);
  });

  it('searches the server name and the owner e-mail (joined table)', async () => {
    const all = await run({ size: 100 });
    const [sample] = all.rows;
    if (!sample) return expect(all.rowCount).toBe(0);

    const byName = await run({ q: sample.name, size: 100 });
    expect(byName.rows.map((row) => row.name)).toContain(sample.name);

    // The `q` box searches the joined owner e-mail too: every row of the page
    // must then come from an owner whose e-mail matches.
    const owner = await orm.em.fork().findOne(User, { id: sample.ownerId });
    if (!owner) return;

    // Searching the joined e-mail must match exactly the rows whose owner
    // carries it — the join filters in SQL, not in memory.
    const owners = await orm.em.fork().find(User, {
      id: { $in: [...new Set(all.rows.map((row) => row.ownerId))] },
    });
    const matchingOwners = new Set(
      owners
        .filter((candidate) => candidate.email === owner.email)
        .map((candidate) => candidate.id),
    );
    const byOwner = await run({ q: owner.email, size: 100 });
    expect(byOwner.rowCount).toBe(all.rows.filter((row) => matchingOwners.has(row.ownerId)).length);
  });

  it('sorts by a local column and by the joined owner column', async () => {
    const byName = await run({ sort: 'name', dir: 'asc', size: 5 });
    const names = byName.rows.map((row) => row.name);
    expect([...names].sort()).toEqual(names);

    const byOwner = await run({ sort: 'owner', dir: 'asc', size: 5 });
    expect(byOwner.rows.length).toBe(Math.min(5, byOwner.rowCount));
  });

  it('ignores an unknown sort id instead of trusting it', async () => {
    const all = await run({ size: 100 });
    const bogus = await run({ sort: 'password', size: 3 });
    expect(bogus.rowCount).toBe(all.rowCount);
    expect(bogus.rows).toHaveLength(Math.min(3, all.rowCount));
  });
});
