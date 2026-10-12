import { Skeleton } from '~/components/ui/skeleton';

/**
 * Loading placeholder for the listing table — same columns as the real
 * table so the swap is not jarring.
 */
export function FileTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2 pl-4 pr-4 font-medium">Nom</th>
          <th className="py-2 pr-4 font-medium">Taille</th>
          <th className="py-2 pr-4 font-medium">Modifié</th>
          <th className="py-2 pr-4 text-right font-medium">Actions</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, i) => (
          <tr key={i} className="border-b">
            <td className="py-2 pl-4 pr-4">
              <div className="flex items-center gap-2">
                <Skeleton className="size-4 shrink-0 rounded" />
                <Skeleton className="h-4 w-40 max-w-full" />
              </div>
            </td>
            <td className="py-2 pr-4">
              <Skeleton className="h-4 w-14" />
            </td>
            <td className="py-2 pr-4">
              <Skeleton className="h-4 w-32" />
            </td>
            <td className="py-2 pr-4">
              <div className="flex justify-end gap-1">
                <Skeleton className="size-7 rounded-md" />
                <Skeleton className="size-7 rounded-md" />
                <Skeleton className="size-7 rounded-md" />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
