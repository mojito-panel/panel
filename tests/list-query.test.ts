import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import { Server } from '~/db/entities';
import { defineList, expr, field, tableStateToQuery, type DefinedList } from '~/lists/define';
import { applyListQuery, listQueryBuilder } from '~/server/list/query';

/**
 * List contract (Zod query + MikroORM mapping).
 *
 * The SQL assertions run against a metadata-only Postgres ORM (`connect: false`):
 * the query is built and formatted offline, so the shape of every WHERE/JOIN/
 * ORDER BY the panel generates is covered without needing a database — the
 * `$ilike` operator is Postgres-only and would not survive the SQLite test
 * driver used by the entity tests.
 */

const STATUSES = [
  { value: 'stopped', label: 'Arrêté' },
  { value: 'running', label: 'En marche' },
] as const;

interface Row {
  id: string;
  name: string;
  status: string;
  suspended: boolean;
  ownerEmail: string;
}

/** Representative list: text (root + joined), multi-choice, boolean, sorts. */
const serversList: DefinedList<Row> = defineList<Row>({
  name: 'test-servers',
  alias: 's',
  defaultSort: { column: 'createdAt', desc: true },
  searchTargets: ['name', 'u.email'],
  joins: { u: { table: 'user', alias: 'u', left: 'id', right: 's.owner_id' } },
  columns: {
    name: {
      header: 'Nom',
      cell: (row) => row.name,
      sort: field('name'),
      filter: { control: 'text', target: field('name') },
    },
    owner: {
      header: 'Propriétaire',
      cell: (row) => row.ownerEmail,
      sort: field('u.email'),
      filter: { control: 'text', target: field('u.email') },
    },
    status: {
      header: 'Statut',
      cell: (row) => row.status,
      sort: field('status'),
      filter: { control: 'choice', target: field('status'), options: STATUSES, multiple: true },
    },
    suspended: {
      header: 'Suspendu',
      cell: (row) => row.suspended,
      filter: { control: 'boolean', target: field('suspended') },
    },
    node: {
      header: 'Node',
      cell: (row) => row.id,
      filter: { control: 'choice', target: field('nodeId'), dynamic: true },
    },
    assigned: {
      header: 'Affecté',
      cell: (row) => row.id,
      filter: { control: 'nullable', target: field('ownerId'), labels: ['Libre', 'Occupé'] },
    },
    createdAt: { header: 'Créé le', cell: (row) => row.id, sort: field('createdAt') },
    actions: { header: '', cell: () => null, pinned: true },
  },
});

/** Raw-fragment target (a JSON column filter, e.g. the recipe docker image). */
const recipesList: DefinedList<Row> = defineList<Row>({
  name: 'test-recipes',
  alias: 'r',
  defaultSort: { column: 'name', desc: false },
  columns: {
    name: { header: 'Recette', cell: (row) => row.name, sort: field('name') },
    image: {
      header: 'Image',
      cell: (row) => row.status,
      filter: {
        control: 'choice',
        target: expr(`"r"."json"->>'docker_image'`),
        options: [
          { value: 'ghcr.io/mojito/windows-jdk21:latest', label: 'JDK 21' },
          { value: 'ghcr.io/mojito/steamcmd:latest', label: 'SteamCMD' },
        ],
      },
    },
  },
});

/** Parsed query of a list, with `{}` (an empty URL) as the baseline. */
function parseQuery(list: DefinedList<Row>, input: Record<string, unknown>) {
  return list.querySchema.parse(input);
}

describe('list definitions', () => {
  it('rejects a column id that shadows a query key', () => {
    expect(() =>
      defineList<Row>({
        name: 'bad',
        alias: 'b',
        columns: { page: { header: 'Page', cell: () => null, sort: field('id') } },
        defaultSort: { column: 'page' },
      }),
    ).toThrow(/reserved/);
  });

  it('rejects a joined path without its join', () => {
    expect(() =>
      defineList<Row>({
        name: 'bad',
        alias: 'b',
        columns: {
          owner: {
            header: 'Owner',
            cell: () => null,
            filter: { control: 'text', target: field('u.email') },
          },
        },
      }),
    ).toThrow(/join "u" is not declared/);
  });

  it('rejects a sortable list without a default sort', () => {
    expect(() =>
      defineList<Row>({
        name: 'bad',
        alias: 'b',
        columns: { name: { header: 'Nom', cell: () => null, sort: field('name') } },
      }),
    ).toThrow(/needs a defaultSort/);
  });

  it('rejects a default sort on a column that does not sort', () => {
    expect(() =>
      defineList<Row>({
        name: 'bad',
        alias: 'b',
        columns: { actions: { header: '', cell: () => null, pinned: true } },
        defaultSort: { column: 'actions' },
      }),
    ).toThrow(/not a sortable column/);
  });

  it('rejects a choice filter without exactly one options source', () => {
    expect(() =>
      defineList<Row>({
        name: 'bad',
        alias: 'b',
        columns: {
          status: {
            header: 'Statut',
            cell: () => null,
            filter: { control: 'choice', target: field('status'), options: STATUSES, dynamic: true },
          },
        },
      }),
    ).toThrow(/static options or dynamic options/);

    expect(() =>
      defineList<Row>({
        name: 'bad',
        alias: 'b',
        columns: {
          status: {
            header: 'Statut',
            cell: () => null,
            filter: { control: 'choice', target: field('status') },
          },
        },
      }),
    ).toThrow(/static options or dynamic options/);
  });

  it('rejects a search target that needs an undeclared join', () => {
    expect(() =>
      defineList<Row>({
        name: 'bad',
        alias: 'b',
        searchTargets: ['u.email'],
        columns: {
          name: { header: 'Nom', cell: () => null, filter: { control: 'text', target: field('name') } },
        },
      }),
    ).toThrow(/needs the join "u"/);
  });
});

describe('list query schema', () => {
  it('defaults page/size/dir and leaves the sort to the list', () => {
    const query = parseQuery(serversList, {});
    expect(query.page).toBe(1);
    expect(query.size).toBe(25);
    // Absent = "the list's own default direction" (see defineList).
    expect(query.dir).toBeUndefined();
    expect(query.sort).toBeUndefined();
  });

  it('accepts the string form of every param (URL) and the typed form (RPC)', () => {
    expect(parseQuery(serversList, { page: 3, size: 50, sort: 'name', dir: 'asc' })).toMatchObject({
      page: 3,
      size: 50,
      sort: 'name',
      dir: 'asc',
    });
    expect(parseQuery(serversList, { page: '3', size: '50' })).toMatchObject({ page: 3, size: 50 });
  });

  it('strips unknown params — only declared columns filter', () => {
    const query = parseQuery(serversList, { ownerId: 'abc', password: 'x', name: 'mc' });
    expect(query.name).toBe('mc');
    expect('ownerId' in query).toBe(false);
    expect('password' in query).toBe(false);
  });

  it('keeps the sort allowlist and falls back on a stale value', () => {
    expect(parseQuery(serversList, { sort: 'status' }).sort).toBe('status');
    expect(parseQuery(serversList, { sort: 'actions' }).sort).toBeUndefined();
    expect(parseQuery(serversList, { sort: 'id; drop table server' }).sort).toBeUndefined();
  });

  it('drops empty, oversized and unknown filter values', () => {
    expect(parseQuery(serversList, { name: '   ' }).name).toBeUndefined();
    expect(parseQuery(serversList, { name: 'x'.repeat(129) }).name).toBeUndefined();
    expect(parseQuery(serversList, { status: 'bogus' }).status).toBeUndefined();
    expect(parseQuery(serversList, { suspended: 'maybe' }).suspended).toBeUndefined();
  });

  it('keeps a comma-separated multi-choice filter, dropping unknown values', () => {
    expect(parseQuery(serversList, { status: 'running,stopped' }).status).toBe('running,stopped');
    expect(parseQuery(serversList, { status: 'running,bogus' }).status).toBe('running');
    expect(parseQuery(serversList, { status: 'bogus' }).status).toBeUndefined();
    // A repeated query key is parsed as an array by the router.
    expect(parseQuery(serversList, { status: ['running', 'stopped'] }).status).toBe(
      'running,stopped',
    );
  });

  it('accepts an id filter without an allowlist (options come from the page)', () => {
    const query = parseQuery(serversList, { suspended: 'true', node: 'abc123' });
    expect(query.node).toBe('abc123');
  });

  it('accepts both states of a nullable filter and drops anything else', () => {
    expect(parseQuery(serversList, { assigned: 'true' }).assigned).toBe('true');
    expect(parseQuery(serversList, { assigned: 'false' }).assigned).toBe('false');
    expect(parseQuery(serversList, { assigned: 'maybe' }).assigned).toBeUndefined();
  });

  it('clamps paging bounds instead of failing', () => {
    expect(parseQuery(serversList, { page: '0' }).page).toBe(1);
    expect(parseQuery(serversList, { size: '5000' }).size).toBe(25);
    expect(parseQuery(serversList, { size: '0' }).size).toBe(25);
  });
});

describe('table state', () => {
  it('reads the default sort when the URL carries none', () => {
    expect(serversList.readTableState(parseQuery(serversList, {})).sorting).toEqual([
      { id: 'createdAt', desc: true },
    ]);
  });

  it('reads page, sort and filters out of the search params', () => {
    const state = serversList.readTableState(
      parseQuery(serversList, { page: '2', sort: 'name', dir: 'asc', status: 'running,stopped' }),
    );
    expect(state.pageIndex).toBe(1);
    expect(state.sorting).toEqual([{ id: 'name', desc: false }]);
    expect(state.columnFilters).toEqual([{ id: 'status', value: 'running,stopped' }]);
  });

  it('writes table state back, resetting the page and clearing removed filters', () => {
    const current = parseQuery(serversList, { page: '4', status: 'running', name: 'mc' });
    const next = tableStateToQuery({ columnFilters: [{ id: 'name', value: 'survie' }] }, current, serversList);
    expect(next.page).toBe(4);
    expect(next.name).toBe('survie');
    expect(next.status).toBeUndefined();
  });

  it('resets the page index when only the page changes', () => {
    const current = parseQuery(serversList, {});
    expect(tableStateToQuery({ pageIndex: 2, pageSize: 10 }, current, serversList)).toMatchObject({
      page: 3,
      size: 10,
    });
  });

  it('falls back to the default sort when the sorting is cleared', () => {
    const next = tableStateToQuery({ sorting: [] }, parseQuery(serversList, {}), serversList);
    expect(next.sort).toBe('createdAt');
    expect(next.dir).toBe('desc');
  });
});

describe('mikroORM mapping', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init({
      dbName: 'mojito',
      clientUrl: 'postgres://unused:unused@127.0.0.1:1/unused',
      entities: [Server],
      connect: false,
    });
  });

  afterAll(async () => {
    await orm.close(true);
  });

  function sqlOf(list: DefinedList<Row>, input: Record<string, unknown>) {
    const em = orm.em.fork();
    const qb = listQueryBuilder(em, Server, list);
    applyListQuery(qb, list.spec, parseQuery(list, input));
    return qb.getFormattedQuery();
  }

  it('pulls the joined table only when a filter or sort needs it', () => {
    expect(sqlOf(serversList, {})).not.toContain('left join');
    expect(sqlOf(serversList, { owner: 'mc' })).toContain(
      'left join "user" as "u" on "u"."id" = "s"."owner_id"',
    );
    expect(sqlOf(serversList, { sort: 'owner' })).toContain('left join "user" as "u"');
  });

  it('filters on a joined column and sorts by it', () => {
    const sql = sqlOf(serversList, { owner: 'mc', sort: 'owner', dir: 'asc' });
    expect(sql).toContain('"u"."email" ilike');
    expect(sql).toContain(`order by "u"."email" asc, "s"."id" asc`);
  });

  it('maps text, multi-choice and boolean filters to ILIKE / IN / equality', () => {
    const sql = sqlOf(serversList, {
      name: 'mc',
      status: 'running,stopped',
      suspended: 'true',
    });
    expect(sql).toContain('"s"."name" ilike');
    expect(sql).toContain('"s"."status" in (');
    expect(sql).toContain('"s"."suspended" = true');
  });

  it('escapes LIKE wildcards typed by the user', () => {
    expect(sqlOf(serversList, { name: '100%_x' })).toContain(String.raw`100\\%\\_x`);
  });

  it('builds the global search over the searchable columns', () => {
    const sql = sqlOf(serversList, { q: 'mc' });
    expect(sql).toContain('"s"."name" ilike');
    expect(sql).toContain('"u"."email" ilike');
    expect(sql).toContain(' or ');
    // The joined path of a search target must pull its join in.
    expect(sql).toContain('left join "user" as "u"');
  });

  it('filters on a raw fragment target (JSON column)', () => {
    const sql = sqlOf(recipesList, { image: 'ghcr.io/mojito/windows-jdk21:latest' });
    expect(sql).toContain(`"r"."json"->>'docker_image' = 'ghcr.io/mojito/windows-jdk21:latest'`);
  });

  it('filters a nullable column on both states', () => {
    const free = sqlOf(serversList, { assigned: 'true' });
    const taken = sqlOf(serversList, { assigned: 'false' });
    expect(free).toContain('"s"."owner_id" is null');
    expect(taken).toContain('"s"."owner_id" is not null');
  });

  it('applies the default sort with its own direction when the URL carries none', () => {
    const sql = sqlOf(serversList, {});
    expect(sql).toContain('order by "s"."created_at" desc, "s"."id" asc');
    expect(sql).toContain('limit 25');
  });

  it('paginates from the page number and keeps the default size', () => {
    const sql = sqlOf(serversList, { page: '3', size: '10' });
    expect(sql).toContain('limit 10 offset 20');
  });
});
