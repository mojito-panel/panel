import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { parseSearch, stringifySearch } from '~/lib/search-params';
import { routeTree } from './routeTree.gen';

/**
 * Router context — shared by all routes.
 * The queryClient is created here (one instance per request on the server,
 * singleton on the client) and passed into the TanStack Router context.
 */
export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * TanStack router instance — shared client/server.
 * staleTime 60s: avoids needless refetches (session, lists).
 */
export function getRouter() {
  const router = createRouter({
    routeTree,
    parseSearch,
    stringifySearch,
    context: {
      queryClient: new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            // 4xx errors (HttpError.statusCode — 401/403…) never recover on
            // retry: fail fast so the route guards can redirect instead of
            // hanging through the exponential backoff (e.g. after sign-out).
            retry: (failureCount, error) => {
              const statusCode = (error as { statusCode?: number }).statusCode;
              if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
    },
    defaultViewTransition: true,
    scrollRestoration: true,
  });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
