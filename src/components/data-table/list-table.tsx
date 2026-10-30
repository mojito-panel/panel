import type { RowData } from '@tanstack/react-table';

import { ClientDataTable } from '~/components/data-table/client-data-table';
import { DataTable, type DataTableProps } from '~/components/data-table/data-table';

/**
 * The list table a page renders. It picks the mode declared by the list itself
 * (`mode: 'client'` for rows already in the browser), so a page never has to know
 * whether MikroORM or the browser does the filtering.
 */
export function ListTable<TData extends RowData, TContext = void>(
  props: DataTableProps<TData, TContext>,
) {
  if (props.list.mode === 'client') {
    return <ClientDataTable {...props} />;
  }

  return <DataTable {...props} />;
}
