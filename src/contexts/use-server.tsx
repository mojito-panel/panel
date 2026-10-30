import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';

import { LIVE_MAX_AGE_MS, isLiveData } from '~/components/status-badge';
import { getServerFn, getServerRuntimeFn } from '~/server/functions/servers';

/**
 * Server-scoped data of the /servers/$serverId layout — ONE pair of queries
 * feeds the sidebar and every child page (the query cache dedupes the
 * observers). Outside a <ServerProvider>, `useServer()` returns null and
 * the sidebar falls back to its dashboard/admin variant.
 */
export interface ServerSnapshot {
  /** Route param — always set (the provider's own prop). */
  serverId: string;
  /** DB detail (getServerFn) — undefined while in flight or on error. */
  server?: Awaited<ReturnType<typeof getServerFn>>;
  /** Live agent answer (getServerRuntimeFn) — polled every 5 s. */
  runtime?: Awaited<ReturnType<typeof getServerRuntimeFn>>;
  /**
   * Status to DISPLAY: the live agent answer when it has one, the DB row
   * otherwise (agent unreachable, or before the first poll). The DB status is
   * only a writeback of the last successful poll — reading it alone leaves
   * the UI stale between polls.
   */
  status: string;
  /** The live runtime answer is fresh (< 20 s) — sonar rings in the UI. */
  statusLive: boolean;
  /** The live agent query is in flight. */
  statusFetching: boolean;
  /** The recipe row changed after the server's snapshot was synced. */
  recipeUpdatePending: boolean;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

const ServerContext = createContext<ServerSnapshot | null>(null);

export function ServerProvider({ serverId, children }: { serverId: string; children: ReactNode }) {
  const detail = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServerFn({ data: { serverId } }),
  });

  const runtime = useQuery({
    queryKey: ['server-runtime', serverId],
    queryFn: () => getServerRuntimeFn({ data: { serverId } }),
    refetchInterval: 5000,
  });

  // Freshness is time-based, not data-based: re-render on the live threshold
  // so the sonar rings fade out even when polling stalls (hidden tab, error).
  const [, forceTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(forceTick, LIVE_MAX_AGE_MS);
    return () => clearInterval(timer);
  }, []);

  const server = detail.data;
  // The recipe CONTENT changed after the server's snapshot was synced — the
  // Variables tab pings (same signal as the settings page reload button,
  // computed server-side by hash).
  const recipeUpdatePending = !!server?.recipe.outdated;

  return (
    <ServerContext
      value={{
        serverId,
        server,
        runtime: runtime.data,
        status: runtime.data?.status ?? server?.status ?? 'unknown',
        statusLive: runtime.data?.status != null && isLiveData(runtime),
        statusFetching: runtime.isPending,
        recipeUpdatePending,
        isPending: detail.isPending,
        isSuccess: detail.isSuccess,
        error: detail.error ?? null,
        refetch: detail.refetch,
      }}
    >
      {children}
    </ServerContext>
  );
}

/** Server-scoped data of the current layout — null outside a <ServerProvider>. */
export function useServer(): ServerSnapshot | null {
  return useContext(ServerContext);
}
