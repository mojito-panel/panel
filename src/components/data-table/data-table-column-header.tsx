import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

/**
 * The slice of a TanStack column a header needs. Keeping it structural (instead
 * of importing `Column<Features, …>`) lets the same header serve the server-side
 * and the client-side table without leaking a feature type into the component.
 */
export interface SortableColumn {
  getCanSort: () => boolean;
  getIsSorted: () => false | 'asc' | 'desc';
  toggleSorting: () => void;
}

/** Column header — a button when the column sorts (server-side or client-side). */
export function DataTableColumnHeader({
  column,
  title,
  className,
}: {
  column: SortableColumn;
  title: ReactNode;
  className?: string;
}) {
  const label = (
    <span
      className={cn('text-muted-foreground text-xs font-medium tracking-wide uppercase', className)}
    >
      {title}
    </span>
  );

  if (!column.getCanSort()) {
    return label;
  }

  const sorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ms-2 h-7 gap-1 px-2"
      onClick={() => column.toggleSorting()}
    >
      {label}
      {sorted === 'asc' ? (
        <ArrowUp />
      ) : sorted === 'desc' ? (
        <ArrowDown />
      ) : (
        <ChevronsUpDown className="opacity-50" />
      )}
    </Button>
  );
}
