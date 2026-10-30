import { QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  redirect,
} from '@tanstack/react-router';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

import { Toaster } from '~/components/ui/sonner';
import { AuthProvider } from '~/contexts/use-auth';
import type { BrandingSettings } from '~/lib/settings';
import type { RouterContext } from '~/router';
import { getSession } from '~/server/functions/auth';
import { getBrandingFn } from '~/server/functions/settings';
import { getSetupStatusFn } from '~/server/functions/setup';

import styles from '~/styles.css?url';

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  /**
   * SSR beforeLoad: fetches the session, the setup status and the branding
   * settings server-side and caches them in TanStack Query (queryKeys:
   * ['auth'], ['setup'], ['branding']). The 60s staleTime avoids refetches.
   *
   * First-run setup: while no account exists, every page redirects to
   * /setup; once an account exists, /setup redirects back to /.
   */
  beforeLoad: async ({ context: { queryClient }, location }) => {
    const [authSession, setupStatus, branding] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: ['auth'],
        queryFn: () => getSession(),
      }),
      queryClient.fetchQuery({
        queryKey: ['setup'],
        queryFn: () => getSetupStatusFn(),
      }),
      queryClient.fetchQuery({
        queryKey: ['branding'],
        queryFn: () => getBrandingFn(),
      }),
    ]);

    const needsSetup = setupStatus.needsSetup;
    const onSetupRoute = location.pathname === '/setup';
    if (needsSetup && !onSetupRoute) {
      throw redirect({ to: '/setup' });
    }
    if (!needsSetup && onSetupRoute) {
      throw redirect({ to: '/' });
    }

    return {
      user: authSession?.user ?? null,
      session: authSession?.session ?? null,
      needsSetup,
      branding,
    };
  },
  component: RootComponent,
});

function RootComponent() {
  const { queryClient, user, session, branding } = Route.useRouteContext();

  return (
    <RootDocument branding={branding}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider user={user} session={session}>
          <Outlet />
        </AuthProvider>
      </QueryClientProvider>
    </RootDocument>
  );
}

/**
 * Full document — the <title> and favicon come from the branding settings
 * (admin > Paramètres), rendered server-side so the tab is correct on the
 * very first paint.
 */
/**
 * Applies the stored theme BEFORE the first paint — next-themes only syncs
 * the class after hydration, which would flash the wrong palette. Mirrors
 * the ThemeProvider: localStorage key "theme", default "system", `.dark`
 * class on <html>. Fails dark on any error (the panel was dark-first).
 */
const THEME_INIT_SCRIPT = `!function(){try{var t=localStorage.getItem("theme")||"system",d="dark"===t||("system"===t&&window.matchMedia("(prefers-color-scheme: dark)").matches),c=document.documentElement.classList;d?c.add("dark"):c.remove("dark")}catch(e){document.documentElement.classList.add("dark")}}()`;

function RootDocument({ children, branding }: { children: ReactNode; branding: BrandingSettings }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* pre-paint theme class — must run before the stylesheet paints */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
        <title>{branding.appName}</title>
        {branding.favicon !== '' && <link rel="icon" href={branding.favicon} />}
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          {/* richColors: success/error/warning toasts get their own palette.
              Inside ThemeProvider so sonner follows the active theme. */}
          <Toaster richColors closeButton position="bottom-right" />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
