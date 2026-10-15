import { z } from 'zod';
import type { ReactNode } from 'react';

/**
 * Reusable list contract — everything a list needs in ONE place: its columns
 * (UI) plus, on the same entries, the sort/filter mapping that feeds MikroORM.
 *
 * PURE TypeScript + Zod (the only React import is type-only), so a route
 * (client) and a server function (server) import the SAME module: the table's
 * columns and the database's filters cannot drift apart.
 *
 * Conventions:
 * - a list is a RECORD keyed by column id — that id is at once the TanStack
 *   column id, the URL search-param key, the sort key and the filter key;
 * - every filter value travels as a STRING (`'running'`, `'a,b'`, `'true'`) in
 *   the URL *and* in the server-function payload, so a single Zod schema
 *   validates both sides (`applyListQuery` turns it into the ORM condition);
 * - a target can only be declared on the column it belongs to, and a join is
 *   pulled in by the alias prefix of the paths using it (`field('u.email')` →
 *   the join aliased `u`), so an undeclared column cannot be sorted/filtered.
 */

// ─── Query (URL search params + server-function payload) ─────────────────────

/** Query keys owned by the contract — a column id may never shadow them. */
export const RESERVED_QUERY_KEYS = ['page', 'size', 'sort', 'dir', 'q'] as const;

/** Page sizes offered by the shared pagination footer. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Who does the filtering, sorting and pagination: `server` (MikroORM, the default
 * — one page at a time) or `client` (rows already in the browser, for data that
 * is not database-backed, e.g. the agent-backed file browser).
 */
export type ListMode = 'server' | 'client';

export const DEFAULT_PAGE_SIZE = 25;
/** Upper bound accepted for `size` (a page fetch stays bounded). */
const MAX_PAGE_SIZE = 100;

/**
 * The validated query of every list. `page`/`size` are coerced (the URL carries
 * strings, the server function carries numbers — one schema accepts both);
 * filter values are the string forms documented above.
 */
export interface ListQuery {
  page: number;
  size: number;
  /** Sorted column id — absent means the list's default sort. */
  sort?: string;
  /** Absent means the default sort's own direction. */
  dir?: 'asc' | 'desc';
  /** Global search across the list's `searchTargets`. */
  q?: string;
  [filterColumn: string]: unknown;
}

/** What every list server function returns. */
export interface ListResult<TData> {
  rows: TData[];
  /** Total matching rows, ignoring pagination. */
  rowCount: number;
}

/** Sorting state (TanStack Table shape). */
export interface ListSortState {
  id: string;
  desc: boolean;
}

/** Base query schema — every sortable list overrides `sort` with its own enum. */
const listBaseSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
  sort: z.string().optional().catch(undefined),
  // No default direction here: an absent `dir` means "the list's own default
  // sort direction", which `stripSearchParams(list.defaultSearch)` relies on to
  // drop a defaulted URL (a fixed fallback would contradict an ascending list).
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
  q: z.string().trim().max(128).optional().catch(undefined),
});

// ─── Targets (where a column reads from) ────────────────────────────────────

/**
 * Where a column reads from in SQL: an ORM property path of the root entity,
 * optionally alias-qualified for a joined table (`field('u.email')`), or a raw
 * fragment for a computed / JSON path (`expr(`"r"."json"->>'type'`)`).
 */
export type ListPath = { path: string } | { sql: string };

/** ORM property path — `field('name')`, or `field('u.email')` for the join `u`. */
export function field(path: string): ListPath {
  return { path };
}

/** Raw SQL fragment — computed column or JSON path (`'col'->>'key'`). */
export function expr(sql: string): ListPath {
  return { sql };
}

// ─── Sort / filter declarations ─────────────────────────────────────────────

export interface ListChoiceOption {
  value: string;
  label: string;
}

/** Free text — `ILIKE %value%`. */
export interface ListFilterText {
  control: 'text';
  target: ListPath;
}

/** Fixed set of values — `= value` (single) or `IN (…)` (multiple, `'a,b'`). */
export interface ListFilterChoice {
  control: 'choice';
  target: ListPath;
  /**
   * Static allowlist of the values (validated by the query schema). Omitted when
   * the options come from the page (`dynamic`), e.g. the node picker of the
   * servers list — the value is then only checked for shape, never enumerated.
   */
  options?: readonly ListChoiceOption[];
  /** Options are supplied by the page at render time (`filterOptions` prop). */
  dynamic?: boolean;
  multiple?: boolean;
}

/** Tri-state boolean — `'true'` / `'false'` only (absent = no filter). */
export interface ListFilterBoolean {
  control: 'boolean';
  target: ListPath;
}

/**
 * Nullable column — `'true'` matches the IS NULL rows (a free allocation, a
 * server without an owner…), `'false'` the others.
 */
export interface ListFilterNullable {
  control: 'nullable';
  target: ListPath;
  /** Chips labels: `[null, not null]`. */
  labels?: readonly [string, string];
}

export type ListFilter =
  | ListFilterText
  | ListFilterChoice
  | ListFilterBoolean
  | ListFilterNullable;

/** One column of a list: how it renders, and how it sorts/filters server-side. */
export interface ListColumn<TData, TContext = void> {
  /** Shown in the table header and reused as the filter button label. */
  header: ReactNode;
  /**
   * Cell renderer — receives the row as returned by the list server function,
   * plus the page-provided `rowContext` (row actions need the page's mutations;
   * the list module cannot import a server function that imports it back).
   */
  cell: (row: TData, context: TContext) => ReactNode;
  /**
   * Server-side sorting (allowlist entry) — or `true` for a client-side list
   * (rows already in the browser), where the ORM path would be meaningless.
   */
  sort?: ListPath | true;
  /**
   * Comparison used when sorting in the browser (`sort: true` columns).
   * Defaults to `'text'`.
   */
  sortFn?: 'text' | 'alphanumeric' | 'datetime';
  /** Server-side filter rendered by the shared toolbar. */
  filter?: ListFilter;
  /** Always visible, never offered in the column menu (row actions). */
  pinned?: boolean;
  /** Extra classes for the cells of this column. */
  className?: string;
}

/** A joined table, declared once and pulled in by the paths that need it. */
export interface ListJoin {
  /**
   * Table name of the joined entity. Single-row joins only — a to-many join
   * would multiply rows and break the row count.
   */
  table: string;
  /** Alias used by the paths of this list (also the record key). */
  alias: string;
  /** Joined column compared to the owner side (`on "alias"."left" = <right>`). */
  left: string;
  /** Owner-side expression, e.g. `'s.owner_id'`. */
  right: string;
}

// ─── Derived server spec ────────────────────────────────────────────────────

export interface ListFilterSpec {
  /** Column id — also the query key and the ORM key in the error messages. */
  column: string;
  filter: ListFilter;
}

export interface ListSpec {
  name: string;
  /** Root alias shared by every path in the spec. */
  alias: string;
  filters: readonly ListFilterSpec[];
  sorts: Readonly<Record<string, ListPath>>;
  joins: Readonly<Record<string, ListJoin>>;
  /** Plain paths the `q` search runs `ILIKE` against. */
  searchTargets: readonly string[];
  defaultSort: readonly ListSortState[];
  defaultSize: number;
}

export interface ListTableState {
  pageIndex: number;
  pageSize: number;
  sorting: ListSortState[];
  /** One entry per active filter, keyed by column id (TanStack shape). */
  columnFilters: { id: string; value: string }[];
}

export interface DefinedList<TData, TContext = void> {
  name: string;
  alias: string;
  /** `server` = filtered/sorted/paginated by MikroORM, `client` = in the browser. */
  mode: ListMode;
  columns: Readonly<Record<string, ListColumn<TData, TContext>>>;
  /** Validated query — used by `validateSearch` AND by the server function. */
  querySchema: z.ZodType<ListQuery>;
  spec: ListSpec;
  defaultSort: readonly ListSortState[];
  defaultSize: number;
  /** Defaults stripped from the URL by `stripSearchParams`. */
  defaultSearch: ListQuery;
  /** Validated search params → TanStack Table state. */
  readTableState: (search: ListQuery) => ListTableState;
}

// ─── defineList ─────────────────────────────────────────────────────────────

export interface DefineListOptions<TData, TContext = void> {
  /** Stable name — used in error messages and query keys. */
  name: string;
  /** Root SQL alias every path of this list is written against (`'s'`). */
  alias: string;
  /** Defaults to `server` (MikroORM does the work). */
  mode?: ListMode;
  columns: Record<string, ListColumn<TData, TContext>>;
  /** Sort applied when the URL carries none — required when a column sorts. */
  defaultSort?: { column: string; desc?: boolean };
  defaultSize?: number;
  /**
   * Paths the `q` search runs `ILIKE` against — the "search everything" box of
   * the list (plain ORM paths only, alias-qualified when joined). Empty means no
   * search box.
   */
  searchTargets?: readonly string[];
  /** Joined tables available to the paths of this list (keyed by alias). */
  joins?: Record<string, ListJoin>;
}

/** Value schema of a filter, in its string wire form (see the module header). */
function filterValueSchema(filter: ListFilter): z.ZodType<unknown> {
  switch (filter.control) {
    case 'text':
      return z.string().trim().min(1).max(128).optional().catch(undefined);

    case 'boolean':
      return z.enum(['true', 'false']).optional().catch(undefined);

    case 'nullable':
      return z.enum(['true', 'false']).optional().catch(undefined);

    case 'choice': {
      const values = filter.options?.map((option) => option.value);

      if (!values) {
        // Options supplied by the page: the value is an id, compared for
        // equality — it is never enumerated and never reaches SQL text.
        return z.string().trim().max(64).optional().catch(undefined);
      }

      if (!filter.multiple) {
        return z.enum(values as [string, ...string[]]).optional().catch(undefined);
      }

      // Multiple choice keeps the comma-separated STRING form in the query: the
      // URL round-trip must hand the schema back exactly what it produced. A
      // repeated query key (`?status=a&status=b`) arrives as an array — accepted
      // and folded into the same form. Unknown values are dropped (a stale
      // bookmark must not error the page out).
      return z
        .union([z.string(), z.array(z.string())])
        .optional()
        .catch(undefined)
        .transform((raw) => {
          const tokens = Array.isArray(raw) ? raw : (raw ?? '').split(',');
          const picked = tokens
            .map((token) => token.trim())
            .filter((token) => values.includes(token));

          return picked.length > 0 ? picked.join(',') : undefined;
        });
    }
  }
}

/**
 * Declares a list: builds its query schema (URL + server function), the derived
 * server spec and the helpers the table shell needs. Throws at module load on a
 * malformed declaration, so a typo fails immediately instead of at runtime.
 */
export function defineList<TData, TContext = void>(
  options: DefineListOptions<TData, TContext>,
): DefinedList<TData, TContext> {
  const { name, alias, columns } = options;
  const mode = options.mode ?? 'server';
  const joins = options.joins ?? {};
  const defaultSize = options.defaultSize ?? DEFAULT_PAGE_SIZE;

  for (const [key, join] of Object.entries(joins)) {
    if (key !== join.alias) {
      throw new Error(
        `List "${name}": join "${key}" must be keyed by its alias ("${join.alias}").`,
      );
    }
    if (join.alias === alias) {
      throw new Error(`List "${name}": join "${key}" reuses the root alias "${alias}".`);
    }
    if (!join.table || !join.left || !join.right) {
      throw new Error(`List "${name}": join "${key}" is incomplete.`);
    }
  }

  const filters: ListFilterSpec[] = [];
  const sorts: Record<string, ListPath> = {};
  const shape: Record<string, z.ZodType<unknown>> = {};
  const searchTargets: string[] = [...(options.searchTargets ?? [])];

  for (const path of searchTargets) {
    const alias = path.includes('.') ? path.split('.')[0] : null;
    if (alias && !joins[alias]) {
      throw new Error(
        `List "${name}": search target "${path}" needs the join "${alias}", which is not declared.`,
      );
    }
  }

  if (mode === 'client' && searchTargets.length > 0) {
    throw new Error(
      `List "${name}": a client-side list has no \`q\` search — declare a text filter per column instead.`,
    );
  }

  for (const [column, definition] of Object.entries(columns)) {
    if ((RESERVED_QUERY_KEYS as readonly string[]).includes(column)) {
      throw new Error(
        `List "${name}": column id "${column}" is reserved (${RESERVED_QUERY_KEYS.join(', ')}).`,
      );
    }

    if (definition.sort) {
      if (definition.sort === true) {
        if (mode === 'server') {
          throw new Error(
            `List "${name}": column "${column}" only declares a client-side sort, but the list is server-side.`,
          );
        }
      } else {
        sorts[column] = definition.sort;
      }
    }

    const { filter } = definition;
    if (!filter) continue;

    const target = 'path' in filter.target ? filter.target.path : null;

    if (target && target.includes('.') && !joins[target.split('.')[0]]) {
      throw new Error(
        `List "${name}": filter "${column}" reads "${target}" but join "${target.split('.')[0]}" is not declared.`,
      );
    }

    if (
      filter.control === 'choice' &&
      Boolean(filter.options) === Boolean(filter.dynamic)
    ) {
      throw new Error(
        `List "${name}": filter "${column}" needs either static options or dynamic options.`,
      );
    }

    filters.push({ column, filter });
    shape[column] = filterValueSchema(filter);
  }

  const sortable = [
    ...Object.keys(sorts),
    ...Object.entries(columns)
      .filter(([, definition]) => definition.sort === true)
      .map(([column]) => column),
  ];
  let defaultSort: ListSortState[] = [];

  if (options.defaultSort && !sortable.includes(options.defaultSort.column)) {
    throw new Error(
      `List "${name}": defaultSort "${options.defaultSort.column}" is not a sortable column.`,
    );
  }

  if (sortable.length > 0) {
    if (!options.defaultSort) {
      throw new Error(`List "${name}": a sortable list needs a defaultSort.`);
    }
    defaultSort = [{ id: options.defaultSort.column, desc: options.defaultSort.desc ?? true }];
    shape.sort = z.enum(sortable as [string, ...string[]]).optional().catch(undefined);
  }

  const querySchema = listBaseSchema.extend(shape) as unknown as z.ZodType<ListQuery>;

  return {
    name,
    alias,
    mode,
    columns,
    querySchema,
    spec: {
      name,
      alias,
      filters,
      sorts,
      joins,
      searchTargets,
      defaultSort,
      defaultSize,
    },
    defaultSort,
    defaultSize,
    defaultSearch: {
      page: 1,
      size: defaultSize,
      dir: defaultSort[0] && defaultSort[0].desc === false ? 'asc' : 'desc',
      ...(defaultSort[0] ? { sort: defaultSort[0].id } : {}),
    },
    readTableState: (search) => readTableState(columns, search, defaultSort, defaultSize),
  };
}

/**
 * Validated search params → TanStack Table state. A sort id that is not part of
 * this list is ignored (the default wins) so a stale bookmark stays usable.
 */
function readTableState<TData, TContext>(
  columns: Record<string, ListColumn<TData, TContext>>,
  search: ListQuery,
  defaultSort: readonly ListSortState[],
  defaultSize: number,
): ListTableState {
  const fallbackDir: 'asc' | 'desc' = defaultSort[0]?.desc === false ? 'asc' : 'desc';
  const sorting: ListSortState[] =
    search.sort && columns[search.sort]?.sort
      ? [{ id: search.sort, desc: (search.dir ?? fallbackDir) === 'desc' }]
      : [...defaultSort];

  const columnFilters: { id: string; value: string }[] = [];
  for (const [id, definition] of Object.entries(columns)) {
    if (!definition.filter) continue;
    const value = search[id];
    if (value === undefined || value === null || value === '') continue;
    columnFilters.push({ id, value: String(value) });
  }

  return {
    pageIndex: Math.max(0, search.page - 1),
    pageSize: search.size ?? defaultSize,
    sorting,
    columnFilters,
  };
}

/**
 * Merges a query patch into the validated search params of a route.
 *
 * Required keys stay defined, so a patch carrying `undefined` clears a filter
 * without breaking the type: `navigate({ search: (prev) => mergeQuery(prev, patch) })`.
 */
export function mergeQuery(current: ListQuery, patch: Partial<ListQuery>): ListQuery {
  return {
    ...current,
    ...patch,
    page: patch.page ?? current.page,
    size: patch.size ?? current.size,
    dir: patch.dir ?? current.dir,
  };
}

/** Table state → the search params to write back (page reset included). */
export function tableStateToQuery(
  state: Partial<ListTableState>,
  current: ListQuery,
  list: Pick<DefinedList<unknown>, 'spec'>,
): ListQuery {
  const page = state.pageIndex !== undefined ? state.pageIndex + 1 : current.page;
  const next: ListQuery = {
    ...current,
    page: page < 1 ? 1 : page,
    size: state.pageSize ?? current.size ?? list.spec.defaultSize,
  };

  if (state.sorting !== undefined) {
    const first = state.sorting[0];
    const fallback = list.spec.defaultSort[0];
    next.sort = first?.id ?? fallback?.id;
    next.dir = (first ? first.desc : (fallback?.desc ?? true)) ? 'desc' : 'asc';
  }

  if (state.columnFilters !== undefined) {
    for (const { column } of list.spec.filters) {
      next[column] = undefined;
    }
    for (const { id, value } of state.columnFilters) {
      next[id] = value === '' ? undefined : value;
    }
  }

  return next;
}
