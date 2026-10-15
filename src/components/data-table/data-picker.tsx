import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { RowData } from '@tanstack/react-table';
import { Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DataTable } from '~/components/data-table/data-table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  mergeQuery,
  type DefinedList,
  type ListQuery,
  type ListResult,
} from '~/lists/define';

/** Row actions make no sense inside a picker — the row IS the action. */
const PICKER_HIDDEN_COLUMNS = ['actions'];

/**
 * Pick one row out of a list: the SAME declaration, toolbar, columns and
 * pagination as the list page, opened in a dialog. It replaces the "load every
 * row into a select" pickers, so a picker filters/searches/paginates in the
 * database exactly like its page does.
 */
export interface DataPickerProps<TData extends RowData, TContext = void, TSelection = TData> {
  list: DefinedList<TData, TContext>;
  /** One page of the list — the list page's own server function. */
  fetchPage: (query: ListQuery) => Promise<ListResult<TData>>;
  /** Selection shape the caller stores (a row, or just what it needs from it). */
  toSelection: (row: TData) => TSelection;
  /** How the selection renders next to the button. */
  renderValue: (selection: TSelection) => ReactNode;
  value: TSelection | null;
  onChange: (selection: TSelection | null) => void;
  title: string;
  /** Button label while nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  /** Cells of hidden columns are not rendered — only needed for visible ones. */
  rowContext?: TContext;
}

export function DataPicker<TData extends RowData, TContext = void, TSelection = TData>({
  list,
  fetchPage,
  toSelection,
  renderValue,
  value,
  onChange,
  title,
  placeholder = 'Rechercher',
  disabled = false,
  rowContext,
}: DataPickerProps<TData, TContext, TSelection>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<ListQuery>(list.defaultSearch);

  const query = useQuery({
    queryKey: [list.name, 'picker', search],
    queryFn: () => fetchPage(search),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {value !== null && (
          <Badge variant="secondary" className="gap-1.5">
            {renderValue(value)}
            {!disabled && (
              <button
                type="button"
                aria-label="Retirer la sélection"
                className="opacity-60 hover:opacity-100"
                onClick={() => onChange(null)}
              >
                <X className="size-3" />
              </button>
            )}
          </Badge>
        )}

        {!disabled && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Search />
            {value !== null ? 'Changer' : placeholder}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Clique une ligne pour la choisir.</DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto">
            <DataTable
              list={list}
              rows={query.data?.rows ?? []}
              rowCount={query.data?.rowCount ?? 0}
              search={search}
              onSearchChange={(patch) =>
                setSearch((previous) => mergeQuery(previous, patch))
              }
              isPending={query.isPending}
              isFetching={query.isFetching}
              error={query.error}
              hiddenColumns={PICKER_HIDDEN_COLUMNS}
              rowContext={rowContext}
              onRowClick={(row) => {
                onChange(toSelection(row));
                setOpen(false);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
