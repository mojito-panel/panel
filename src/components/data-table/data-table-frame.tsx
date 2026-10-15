import { flexRender, type ReactTable, type RowData, type TableFeatures } from '@tanstack/react-table';
import { DataTableFilters } from '~/components/data-table/data-table-filters';
import { DataTablePagination } from '~/components/data-table/data-table-pagination';
import { DataTableSkeleton } from '~/components/data-table/data-table-skeleton';
import {
  Table as TablePrimitive,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import type { DefinedList, ListChoiceOption, ListQuery } from '~/lists/define';

/**
 * Presentation shared by both table modes (server-side and client-side): the
 * filter toolbar, the table itself and the pagination footer. Everything is
 * driven by the list definition and by the controlled query, so the two modes
 * differ only in who computes the rows (`DataTable` vs `ClientDataTable`).
 */
export interface DataTableFrameProps<TFeatures extends TableFeatures, TData extends RowData, TContext> {
  table: ReactTable<TFeatures, TData>;
  list: DefinedList<TData, TContext>;
  search: ListQuery;
  onSearchChange: (patch: Partial<ListQuery>) => void;
  /** Rows covered by the footer: the server total, or the client filtered count. */
  rowCount: number;
  isPending?: boolean;
  isFetching?: boolean;
  error?: Error | null;
  emptyMessage?: string;
  filterOptions?: Record<string, readonly ListChoiceOption[]>;
  onRowClick?: (row: TData) => void;
}

export function DataTableFrame<TFeatures extends TableFeatures, TData extends RowData, TContext>({
  table,
  list,
  search,
  onSearchChange,
  rowCount,
  isPending = false,
  isFetching = false,
  error = null,
  emptyMessage = 'Aucun résultat.',
  filterOptions,
  onRowClick,
}: DataTableFrameProps<TFeatures, TData, TContext>) {
  // TanStack Table v9 only resolves the feature APIs (column visibility, cell
  // reads…) for a CONCRETE feature set — inside this generic frame they stay
  // conditional, so the shared pointer is read through an open feature view.
  const view = table as unknown as ReactTable<any, TData, any>;
  const state = list.readTableState(search);

  /** Filter values of the toolbar, in their string wire form. */
  const filterValues: Record<string, string> = {};
  for (const { column } of list.spec.filters) {
    const value = search[column];
    if (value === undefined || value === null || value === '') continue;
    filterValues[column] = String(value);
  }

  const clearFilters = () => {
    const patch: Partial<ListQuery> = { page: 1 };
    for (const { column } of list.spec.filters) patch[column] = undefined;
    onSearchChange(patch);
  };

  const columnOptions = view
    .getAllColumns()
    .filter((column) => column.getCanHide())
    .map((column) => ({
      id: column.id,
      label: list.columns[column.id]?.header ?? column.id,
      visible: column.getIsVisible(),
      toggle: () => column.toggleVisibility(),
    }));

  const pageRows = view.getRowModel().rows;

  // An out-of-range page (a shared URL after deletions, say) is not "no result".
  const emptyText =
    rowCount > 0 && state.pageIndex > 0
      ? 'Cette page est vide — reviens à la page précédente.'
      : emptyMessage;

  return (
    <div className="space-y-4">
      <DataTableFilters
        list={list}
        values={filterValues}
        onChange={(column, value) => onSearchChange({ [column]: value, page: 1 })}
        onClear={clearFilters}
        search={typeof search.q === 'string' ? search.q : ''}
        onSearchChange={(value) => onSearchChange({ q: value === '' ? undefined : value, page: 1 })}
        filterOptions={filterOptions}
        columnOptions={columnOptions}
      />

      {error && <p className="text-sm text-destructive">Erreur : {error.message}</p>}

      <TablePrimitive>
        <TableHeader>
          {view.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isPending ? (
            <DataTableSkeleton columns={view.getAllColumns().length} />
          ) : pageRows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={view.getAllColumns().length}
                className="h-24 text-center text-sm text-muted-foreground"
              >
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            pageRows.map((row) => (
              <TableRow
                key={row.id}
                className={onRowClick ? 'cursor-pointer' : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={list.columns[cell.column.id]?.className}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </TablePrimitive>

      <DataTablePagination
        pageIndex={state.pageIndex}
        pageSize={state.pageSize}
        rowCount={rowCount}
        isFetching={isFetching}
        onPageChange={(pageIndex) => onSearchChange({ page: pageIndex + 1 })}
        onPageSizeChange={(size) => onSearchChange({ size, page: 1 })}
      />
    </div>
  );
}
