import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  type FilterFn,
  type RowData,
  type TableFeatures,
} from '@tanstack/react-table';

/**
 * Client-side twins of the server filters: a filter value is always the STRING
 * wire form (`'mc'`, `'a,b'`, `'true'`), so the same declaration behaves the same
 * way whether MikroORM or the browser does the filtering.
 */
const wireIncludesString: FilterFn<TableFeatures, RowData> = (row, columnId, filterValue) =>
  String(row.getValue(columnId) ?? '')
    .toLowerCase()
    .includes(String(filterValue).toLowerCase());

const wireEquals: FilterFn<TableFeatures, RowData> = (row, columnId, filterValue) =>
  String(row.getValue(columnId)) === String(filterValue);

const wireArrIncludesSome: FilterFn<TableFeatures, RowData> = (row, columnId, filterValue) => {
  const picked = String(filterValue)
    .split(',')
    .filter((token) => token !== '');
  if (picked.length === 0) return true;

  const value = row.getValue(columnId);
  const candidates = Array.isArray(value) ? value.map(String) : [String(value)];
  return picked.some((token) => candidates.includes(token));
};

/** Nullable column: `'true'` keeps the anonymous rows, `'false'` the others. */
const wireIsNull: FilterFn<TableFeatures, RowData> = (row, columnId, filterValue) => {
  const value = row.getValue(columnId);
  const isNull = value === null || value === undefined || value === '';
  return String(filterValue) === 'true' ? isNull : !isNull;
};

/** Registry wired into `clientTableFeatures` (also the test seam). */
export const clientFilterFns = {
  wireIncludesString,
  wireEquals,
  wireArrIncludesSome,
  wireIsNull,
};

/**
 * The two table modes of the panel — the ONLY place a table feature is
 * registered, so every list gets the same sorting/filtering/pagination
 * behaviour (TanStack Table v9 tree-shakes whatever is not listed here).
 *
 * - `serverTableFeatures`: the list is filtered, sorted and paginated by
 *   MikroORM (`~/server/list/query`); the table holds no row model and every
 *   state slice is controlled by the URL search params;
 * - `clientTableFeatures`: the same table for data that is NOT database-backed
 *   (agent-backed file browser, small catalogs) — rows are filtered, sorted and
 *   paginated in the browser.
 */
const serverFeatures = {
  columnFilteringFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  sortFns: {
    text: sortFn_text,
    alphanumeric: sortFn_alphanumeric,
    datetime: sortFn_datetime,
  },
};

/** Filtering/sorting/pagination happen in the database — no row model needed. */
export const serverTableFeatures = tableFeatures({ ...serverFeatures });

/** Same columns, filtered/sorted/paginated in the browser. */
export const clientTableFeatures = tableFeatures({
  ...serverFeatures,
  filterFns: clientFilterFns,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

export type ServerTableFeatures = typeof serverTableFeatures;
export type ClientTableFeatures = typeof clientTableFeatures;
