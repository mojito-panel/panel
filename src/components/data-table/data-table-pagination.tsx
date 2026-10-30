import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { PAGE_SIZES } from '~/lists/define';

/**
 * Pagination footer — identical on every list: the row range, the page size and
 * the four page jumps. `rowCount` is the total of the current query (rows the
 * list server function matched, pagination ignored).
 */
export function DataTablePagination({
  pageIndex,
  pageSize,
  rowCount,
  isFetching,
  onPageChange,
  onPageSizeChange,
}: {
  pageIndex: number;
  pageSize: number;
  rowCount: number;
  isFetching?: boolean;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const firstRow = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min(rowCount, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-muted-foreground text-sm">
        {rowCount === 0
          ? 'Aucun résultat'
          : `${firstRow}–${lastRow} sur ${rowCount}${isFetching ? ' — chargement…' : ''}`}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Lignes</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => value !== null && onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="w-20" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-muted-foreground text-sm">
          Page {pageIndex + 1} sur {pageCount}
        </p>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Première page"
            disabled={pageIndex <= 0}
            onClick={() => onPageChange(0)}
          >
            <ChevronFirst />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Page précédente"
            disabled={pageIndex <= 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Page suivante"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Dernière page"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageCount - 1)}
          >
            <ChevronLast />
          </Button>
        </div>
      </div>
    </div>
  );
}
