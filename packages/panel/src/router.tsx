import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
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
    context: {
      queryClient: new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
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
