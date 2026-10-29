import {
  functionalUpdate,
  type ColumnDef,
  type ColumnFiltersState,
  type RowData,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { DataTableColumnHeader } from '~/components/data-table/data-table-column-header';
import { clientFilterFn } from '~/components/data-table/data-table-columns';
import type { DefinedList, ListQuery, ListTableState } from '~/lists/define';

/**
 * Wiring shared by the two table shells (`DataTable` = server mode,
 * `ClientDataTable` = client mode): the column definitions built from the
 * list declaration, and the sort/filter change handlers that translate a
 * TanStack Table interaction into a search-params patch. One
 * implementation, zero behavioural drift between the modes.
 */

/**
 * Column definitions of a list, in declaration order. The only
 * mode-dependent part: a client list resolves its filter and sort
 * functions in the browser (`wire*` filter fns + sort fns); a server list
 * runs manual and needs none.
 *
 * The features slot stays `any` on purpose: the two tables each run
 * `useTable` with their OWN concrete features type, and a generic
 * placeholder would not resolve TanStack's deferred feature extraction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildColumns<TData extends RowData, TContext>(
  list: DefinedList<TData, TContext>,
  rowContext: TContext | undefined,
  mode: 'server' | 'client',
): ColumnDef<any, TData>[] {
  return Object.entries(list.columns).map(([id, definition]) => {
    const column: ColumnDef<any, TData> = {
      id,
      header: definition.headerCell
        ? () => definition.headerCell?.(rowContext)
        : ({ column }) => (
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
    };
    if (mode === 'client') {
      // The `wire*` fns are registered on `clientTableFeatures` only — the
      // loosely typed column def cannot see that registry, hence the cast.
      column.filterFn = clientFilterFn(
        definition.filter,
        'client',
      ) as ColumnDef<any, TData>['filterFn'];
      column.sortFn = definition.sortFn ?? 'text';
    }
    return column;
  });
}

/**
 * Sort change → search params: the first sorted column wins, an ascending
 * sort writes `dir: 'asc'`, and any sort change resets the page.
 */
export function sortingChangeHandler(
  state: Pick<ListTableState, 'sorting'>,
  onSearchChange: (patch: Partial<ListQuery>) => void,
): (updater: Updater<SortingState>) => void {
  return (updater) => {
    const first = functionalUpdate(updater, state.sorting)[0];
    onSearchChange({ sort: first?.id, dir: first?.desc ? 'desc' : 'asc', page: 1 });
  };
}

/**
 * Filter change → search params: every declared filter is cleared first
 * (a removed chip must leave the URL), then the active ones are written in
 * their STRING wire form, and the page resets.
 */
export function columnFiltersChangeHandler(
  list: { spec: { filters: readonly { column: string }[] } },
  state: Pick<ListTableState, 'columnFilters'>,
  onSearchChange: (patch: Partial<ListQuery>) => void,
): (updater: Updater<ColumnFiltersState>) => void {
  return (updater) => {
    const next = functionalUpdate(updater, state.columnFilters);
    const patch: Partial<ListQuery> = { page: 1 };
    for (const { column } of list.spec.filters) patch[column] = undefined;
    for (const filter of next) {
      patch[filter.id] =
        typeof filter.value === 'string' && filter.value !== '' ? filter.value : undefined;
    }
    onSearchChange(patch);
  };
}
