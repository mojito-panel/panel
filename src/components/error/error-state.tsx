import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';

import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';

/**
 * True when an error message looks like an unreachable agent — the server
 * functions map network failures to a 503 "Agent injoignable" HttpError, but
 * a raw "fetch failed" can still slip through (e.g. panel-side fetch).
 */
export function isAgentUnreachableError(message: string): boolean {
  return (
    message.includes('injoignable') ||
    message.includes('fetch failed') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ENOTFOUND') ||
    message.includes('EHOSTUNREACH') ||
    message.includes('503')
  );
}

/**
 * Friendly error block for a page whose strictly-required data failed to
 * load — an unreachable agent gets a dedicated explanation (the agent
 * daemon runs on the node, not the panel), anything else falls back to the
 * raw message.
 *
 * `bare` renders without the dashed border / top margin — used when the
 * block sits inside a card.
 */
export function ErrorState({
  message,
  onRetry,
  bare = false,
}: {
  message: string;
  onRetry?: () => void;
  bare?: boolean;
}) {
  const unreachable = isAgentUnreachableError(message);

  return (
    <div
      className={
        bare
          ? 'flex flex-col items-center gap-3 px-6 py-10 text-center'
          : 'mt-6 flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center'
      }
    >
      {unreachable ? (
        <>
          <CloudOff className="size-8 text-muted-foreground" />
          <p className="font-medium">Agent injoignable</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Le nœud qui héberge ce serveur ne répond pas. Vérifie que l’agent
            tourne sur la machine et que son port est ouvert, puis réessaie.
          </p>
        </>
      ) : (
        <>
          <TriangleAlert className="size-8 text-destructive" />
          <p className="font-medium">Une erreur est survenue</p>
          <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        </>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw />
          Réessayer
        </Button>
      )}
    </div>
  );
}

/**
 * Page skeleton for a strictly-required query still in flight — the card
 *-shaped placeholder the page replaces with its content (or an ErrorState)
 * once the query settles.
 */
export function PageSkeleton({ bare = false }: { bare?: boolean }) {
  return (
    <div
      className={
        bare
          ? 'space-y-3'
          : 'mt-6 space-y-3 rounded-lg border border-dashed px-6 py-10'
      }
    >
      <Skeleton className="mx-auto h-5 w-48" />
      <Skeleton className="mx-auto h-4 w-64" />
      <Skeleton className="mx-auto h-8 w-24" />
    </div>
  );
}
