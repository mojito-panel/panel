import { createRouter } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';

/**
 * Context du router — partagé entre toutes les routes.
 * Le queryClient est créé ici (une instance par requête côté serveur,
 * singleton côté client) et passé dans le context TanStack Router.
 */
export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * Instance du router TanStack — partagée client/serveur.
 * staleTime 60s : évite les refetch inutiles (session, listes).
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
