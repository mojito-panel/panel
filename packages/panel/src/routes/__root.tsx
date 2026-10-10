import type { ReactNode } from 'react';
import {
  Outlet,
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import type { RouterContext } from '~/router';
import { getSession } from '~/server/functions/auth';
import { AuthProvider } from '~/contexts/use-auth';
import { Toaster } from '~/components/ui/sonner';
import styles from '~/styles.css?url';

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Mojito Panel' },
    ],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  /**
   * SSR beforeLoad: fetches the session server-side and caches it
   * in TanStack Query (queryKey: ['auth']). The 60s staleTime avoids refetches.
   */
  beforeLoad: async ({ context: { queryClient } }) => {
    const authSession = await queryClient.fetchQuery({
      queryKey: ['auth'],
      queryFn: () => getSession(),
    });

    return {
      user: authSession?.user ?? null,
      session: authSession?.session ?? null,
    };
  },
  component: RootComponent,
});

function RootComponent() {
  const { queryClient, user, session } = Route.useRouteContext();

  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <AuthProvider user={user} session={session}>
          <Outlet />
        </AuthProvider>
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className='dark'>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {/* richColors: success/error/warning toasts get their own palette */}
        <Toaster richColors closeButton position="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
