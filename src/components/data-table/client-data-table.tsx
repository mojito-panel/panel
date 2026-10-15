import {
  functionalUpdate,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type PaginationState,
  type RowData,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { useState } from 'react';
import { clientFilterFn } from '~/components/data-table/data-table-columns';
import { DataTableColumnHeader } from '~/components/data-table/data-table-column-header';
import { DataTableFrame } from '~/components/data-table/data-table-frame';
import { clientTableFeatures } from '~/components/data-table/features';
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

/** Column definitions of a client-side list (wire-string filters + local sort). */
function buildColumns<TData extends RowData, TContext>(
  list: DefinedList<TData, TContext>,
  rowContext: TContext | undefined,
): ColumnDef<typeof clientTableFeatures, TData>[] {
  return Object.entries(list.columns).map(([id, definition]) => ({
    id,
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title={definition.header}
        className={definition.className}
      />
    ),
    cell: ({ row }) => definition.cell(row.original, rowContext as TContext),
    enableSorting: Boolean(definition.sort),
    enableColumnFilter: Boolean(definition.filter),
    enableHiding: !definition.pinned,
    filterFn: clientFilterFn(definition.filter, 'client'),
    sortFn: definition.sortFn ?? 'text',
  }));
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
  const columns = buildColumns(list, rowContext);

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
    onSortingChange: (updater: Updater<SortingState>) => {
      const first = functionalUpdate(updater, state.sorting)[0];
      onSearchChange({ sort: first?.id, dir: first?.desc ? 'desc' : 'asc', page: 1 });
    },
    onColumnFiltersChange: (updater) => {
      const next = functionalUpdate(updater, state.columnFilters);
      const patch: Partial<ListQuery> = { page: 1 };
      for (const { column } of list.spec.filters) patch[column] = undefined;
      for (const filter of next) {
        patch[filter.id] =
          typeof filter.value === 'string' && filter.value !== '' ? filter.value : undefined;
      }
      onSearchChange(patch);
    },
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
