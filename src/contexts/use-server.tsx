import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isLiveData } from '~/components/status-badge';
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

  const server = detail.data;
  // The recipe row changed after the server's snapshot was synced — the
  // Variables tab pings (same signal as the settings page reload button).
  const recipeUpdatePending =
    !!server?.recipe.updatedAt &&
    !!server.recipe.syncedAt &&
    new Date(server.recipe.updatedAt) > new Date(server.recipe.syncedAt);

  return (
    <ServerContext
      value={{
        serverId,
        server,
        runtime: runtime.data,
        statusLive: runtime.data?.status !== undefined && isLiveData(runtime),
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
