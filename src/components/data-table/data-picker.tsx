import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { RowData } from '@tanstack/react-table';
import { ChevronDown, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { DataTable } from '~/components/data-table/data-table';
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

/**
 * Pick one row out of a list, like a fancy input in a form: `value` +
 * `onChange(selection | null)`, a clear affordance, and a field-shaped trigger
 * with the same geometry as Input. The dialog reuses the SAME list
 * declaration, toolbar, columns and pagination as the list page, so a picker
 * filters/searches/paginates in the database exactly like its page does.
 */
export interface DataPickerProps<TData extends RowData, TContext = void, TSelection = TData> {
  list: DefinedList<TData, TContext>;
  /** One page of the list — the list page's own server function. */
  fetchPage: (query: ListQuery) => Promise<ListResult<TData>>;
  /** Selection shape the caller stores (a row, or just what it needs from it). */
  toSelection: (row: TData) => TSelection;
  /** How the selection renders in the trigger. */
  renderValue: (selection: TSelection) => ReactNode;
  value: TSelection | null;
  onChange: (selection: TSelection | null) => void;
  title: string;
  /** Trigger label while nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  /** The list's row context, when the cells need one (a picker usually has none). */
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
      {/* Field-shaped trigger: same geometry and surface as Input/SelectTrigger
          (h-9, w-full, rounded-3xl, bg-input/50) so the picker lines up with
          the form controls around it. */}
      <div
        data-placeholder={value === null || undefined}
        className="flex h-9 w-full min-w-0 items-center gap-1.5 rounded-3xl border border-transparent bg-input/50 px-3 text-sm whitespace-nowrap transition-[color,box-shadow,background-color] outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 data-placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {value === null ? (
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="flex h-full min-w-0 flex-1 items-center gap-1.5 truncate text-left outline-none"
          >
            <span className="truncate">{placeholder}</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label="Retirer la sélection"
              disabled={disabled}
              onClick={() => onChange(null)}
              className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:pointer-events-none"
            >
              <X className="pointer-events-none size-3.5" />
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className="h-full min-w-0 flex-1 truncate text-left outline-none"
            >
              {renderValue(value)}
            </button>
          </>
        )}
        <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
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
              hiddenColumns={['actions']}
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
