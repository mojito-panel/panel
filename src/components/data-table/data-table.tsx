import {
  functionalUpdate,
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type RowData,
  type Updater,
} from '@tanstack/react-table';
import { useState } from 'react';
import {
  buildColumns,
  columnFiltersChangeHandler,
  sortingChangeHandler,
} from '~/components/data-table/table-wiring';
import { DataTableFrame } from '~/components/data-table/data-table-frame';
import { serverTableFeatures } from '~/components/data-table/features';
import type { DefinedList, ListChoiceOption, ListQuery } from '~/lists/define';

/**
 * The panel's server-side list table: filtering, sorting and pagination run in
 * the database (`applyListQuery`), so the table runs in manual mode — `rows` is
 * the current page and `rowCount` the total of the query. Page, sort and filter
 * state live in the URL search params; the component is fully controlled and
 * never fetches anything, which keeps a list page to a query + `<DataTable />`.
 */
export interface DataTableProps<TData extends RowData, TContext = void> {
  list: DefinedList<TData, TContext>;
  /** Rows of the current page (already filtered/sorted/paginated by the server). */
  rows: TData[];
  /** Total rows matching the query, pagination ignored (client mode computes it). */
  rowCount?: number;
  /** Validated search params of the route (page, sort, filters). */
  search: ListQuery;
  /** Writes query changes back to the URL (page resets are handled here). */
  onSearchChange: (patch: Partial<ListQuery>) => void;
  isPending?: boolean;
  isFetching?: boolean;
  error?: Error | null;
  emptyMessage?: string;
  /** Options of the `dynamic` choice filters (ids coming from another list). */
  filterOptions?: Record<string, readonly ListChoiceOption[]>;
  /** Passed to every cell — the page's mutation callbacks (row actions). */
  rowContext?: TContext;
  /** Columns hidden on mount (e.g. a picker hiding the row actions). */
  hiddenColumns?: string[];
  onRowClick?: (row: TData) => void;
}

export function DataTable<TData extends RowData, TContext = void>({
  list,
  rows,
  rowCount = 0,
  search,
  onSearchChange,
  isPending = false,
  isFetching = false,
  error = null,
  emptyMessage,
  filterOptions,
  rowContext,
  hiddenColumns,
  onRowClick,
}: DataTableProps<TData, TContext>) {
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(() =>
    Object.fromEntries((hiddenColumns ?? []).map((id) => [id, false])),
  );
  const state = list.readTableState(search);
  const columns = buildColumns(list, rowContext, 'server');

  const table = useTable({
    features: serverTableFeatures,
    columns,
    data: rows,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount,
    enableSortingRemoval: false,
    state: {
      pagination: { pageIndex: state.pageIndex, pageSize: state.pageSize },
      sorting: state.sorting,
      columnFilters: state.columnFilters,
      columnVisibility,
    },
    onPaginationChange: (updater: Updater<PaginationState>) => {
      const next = functionalUpdate(updater, {
        pageIndex: state.pageIndex,
        pageSize: state.pageSize,
      });
      // A page-size change must not keep the old offset.
      const lastPage = Math.max(0, Math.ceil(rowCount / next.pageSize) - 1);
      const page = next.pageSize !== state.pageSize ? 0 : Math.min(next.pageIndex, lastPage);
      onSearchChange({ page: page + 1, size: next.pageSize });
    },
    onSortingChange: sortingChangeHandler(state, onSearchChange),
    onColumnFiltersChange: columnFiltersChangeHandler(list, state, onSearchChange),
    onColumnVisibilityChange: setColumnVisibility,
  });

  return (
    <DataTableFrame
      table={table}
      list={list}
      search={search}
      onSearchChange={onSearchChange}
      rowCount={rowCount}
      isPending={isPending}
      isFetching={isFetching}
      error={error}
      emptyMessage={emptyMessage}
      filterOptions={filterOptions}
      onRowClick={onRowClick}
    />
  );
}
