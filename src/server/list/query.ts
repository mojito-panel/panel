import {
  sql,
  type EntityManager,
  type EntityName,
  type QBFilterQuery,
  type QueryOrderMap,
  type SelectQueryBuilder,
} from '@mikro-orm/postgresql';

import type { ListFilterSpec, ListPath, ListQuery, ListResult, ListSpec } from '~/lists/define';

/**
 * Server-side half of the list contract: turns a validated `ListQuery` into a
 * MikroORM query builder query, and returns `{ rows, rowCount }`.
 *
 * Everything a client sends is an id or a value already checked against the
 * list's allowlist by `defineList`'s Zod schema — a raw field name never reaches
 * the ORM (the reverse of a `sortBy=field|dir` + `filter=field|kind|value` wire
 * format, where any column of any table can be reached through the query string).
 *
 * Query shapes used below are the ones verified against Postgres:
 * - a joined table is pulled with `sql.ref(table)` (a raw fragment would be
 *   wrapped as a sub-query: `left join (user) as "u"`);
 * - that join is single-row (its `left` column is unique), which is what keeps
 *   `getResultAndCount()`'s count exact.
 */

/** Root query builder of a list — the alias always comes from the list spec. */
export function listQueryBuilder<T extends object>(
  em: EntityManager,
  entity: EntityName<T>,
  list: { alias: string },
): SelectQueryBuilder<T> {
  return em.createQueryBuilder(entity, list.alias).select(`${list.alias}.*`);
}

/** `%`/`_` are LIKE wildcards — a user typing them must not match everything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** `where`/`orderBy` key of a target — the ORM property path. */
function targetKey(target: ListPath): string {
  return target.path;
}

/** Join alias a path depends on (`'u.email'` → `'u'`), or null for root paths. */
function aliasOfPath(path: string): string | null {
  return path.includes('.') ? path.split('.')[0] : null;
}

/** Join alias a target depends on, or null when it reads the root table. */
function joinAliasOf(target: ListPath): string | null {
  return aliasOfPath(target.path);
}

/** ORM condition of one active filter value. */
function filterCondition(spec: ListFilterSpec, value: unknown): Record<string, unknown> {
  const key = targetKey(spec.filter.target);

  switch (spec.filter.control) {
    case 'text':
      return { [key]: { $ilike: `%${escapeLike(String(value))}%` } };

    case 'boolean':
      return { [key]: { $eq: value === 'true' || value === true } };

    case 'nullable':
      // `'true'` = the rows where the column IS NULL (a free allocation).
      return value === 'true' || value === true
        ? { [key]: { $eq: null } }
        : { [key]: { $ne: null } };

    case 'choice':
      // A multiple-choice filter travels as `'a,b'` in every direction (URL,
      // server payload) — the IN list is rebuilt here.
      return spec.filter.multiple
        ? {
            [key]: {
              $in: String(value)
                .split(',')
                .filter((token) => token !== ''),
            },
          }
        : { [key]: { $eq: value } };
  }
}

/** Applies filters, global search, joins, sorting and pagination to `qb`. */
export function applyListQuery<T extends object>(
  qb: SelectQueryBuilder<T>,
  spec: ListSpec,
  query: ListQuery,
): void {
  const neededJoins = new Set<string>();

  for (const { column, filter } of spec.filters) {
    const value = query[column];
    if (value === undefined || value === null || value === '') continue;

    const alias = joinAliasOf(filter.target);
    if (alias) neededJoins.add(alias);

    qb.andWhere(filterCondition({ column, filter }, value) as QBFilterQuery<T>);
  }

  const search = typeof query.q === 'string' ? query.q.trim() : '';
  if (search !== '' && spec.searchTargets.length > 0) {
    for (const path of spec.searchTargets) {
      const alias = aliasOfPath(path);
      if (alias) neededJoins.add(alias);
    }

    qb.andWhere({
      $or: spec.searchTargets.map((path) => ({
        [path]: { $ilike: `%${escapeLike(search)}%` },
      })),
    } as QBFilterQuery<T>);
  }

  const explicitSort = query.sort ? spec.sorts[query.sort] : undefined;
  const sortTarget = explicitSort ?? spec.sorts[spec.defaultSort[0]?.id ?? ''];
  // An absent direction means "the way the list sorts by default".
  const defaultDirection = spec.defaultSort[0]?.desc === false ? 'asc' : 'desc';
  const direction = explicitSort ? (query.dir ?? defaultDirection) : defaultDirection;

  if (sortTarget) {
    const alias = joinAliasOf(sortTarget);
    if (alias) neededJoins.add(alias);

    qb.orderBy([
      { [targetKey(sortTarget)]: direction } as QueryOrderMap<T>,
      // Tiebreaker: without a unique column, rows can repeat or vanish between
      // two pages when several share the sort value.
      { id: 'asc' } as QueryOrderMap<T>,
    ]);
  } else {
    qb.orderBy({ id: 'asc' } as QueryOrderMap<T>);
  }

  for (const alias of neededJoins) {
    const join = spec.joins[alias];
    qb.leftJoin(sql.ref(join.table), join.alias, {
      [`${join.alias}.${join.left}`]: sql.ref(join.right),
    });
  }

  const page = query.page > 0 ? query.page : 1;
  const size = query.size > 0 ? query.size : spec.defaultSize;
  qb.limit(size).offset((page - 1) * size);
}

/** Runs the list query — the rows plus the total, pagination ignored. */
export async function runListQuery<T extends object>(
  qb: SelectQueryBuilder<T>,
  spec: ListSpec,
  query: ListQuery,
): Promise<ListResult<T>> {
  applyListQuery(qb, spec, query);
  const [rows, rowCount] = await qb.getResultAndCount();
  return { rows, rowCount };
}
