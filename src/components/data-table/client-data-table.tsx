import {
  functionalUpdate,
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type RowData,
  type Updater,
} from '@tanstack/react-table';
import { useState } from 'react';

import { DataTableFrame } from '~/components/data-table/data-table-frame';
import { clientTableFeatures } from '~/components/data-table/features';
import {
  buildColumns,
  columnFiltersChangeHandler,
  sortingChangeHandler,
} from '~/components/data-table/table-wiring';
import type { DefinedList, ListChoiceOption, ListQuery } from '~/lists/define';

/**
 * The same list table for rows that are already in the browser (agent-backed file
 * browser, small catalogs): TanStack filters, sorts and paginates them locally.
 *
 * Declarations, toolbar, columns and the controlled query are shared with the
 * server table, so a list looks and behaves the same in both modes — the only
 * difference is that `rowCount` is the filtered row count here.
 */
export interface ClientDataTableProps<TData extends RowData, TContext = void> {
  list: DefinedList<TData, TContext>;
  rows: TData[];
  /** Validated search params (page, sort, filters) — the page owns where they live. */
  search: ListQuery;
  onSearchChange: (patch: Partial<ListQuery>) => void;
  isPending?: boolean;
  error?: Error | null;
  emptyMessage?: string;
  filterOptions?: Record<string, readonly ListChoiceOption[]>;
  rowContext?: TContext;
  onRowClick?: (row: TData) => void;
}

export function ClientDataTable<TData extends RowData, TContext = void>({
  list,
  rows,
  search,
  onSearchChange,
  isPending = false,
  error = null,
  emptyMessage,
  filterOptions,
  rowContext,
  onRowClick,
}: ClientDataTableProps<TData, TContext>) {
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
  const state = list.readTableState(search);
  const columns = buildColumns(list, rowContext, 'client');

  const table = useTable({
    features: clientTableFeatures,
    columns,
    data: rows,
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
      onSearchChange({ page: next.pageIndex + 1, size: next.pageSize });
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
      rowCount={table.getFilteredRowModel().rows.length}
      isPending={isPending}
      error={error}
      emptyMessage={emptyMessage}
      filterOptions={filterOptions}
      onRowClick={onRowClick}
    />
  );
}
