import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { SidebarProvider } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { AppSidebar } from '~/components/app-sidebar';
import { AppShell } from '~/components/app-shell';
import { getBrandingFn } from '~/server/functions/settings';

/**
 * Protected pages layout — sidebar + content.
 * Not signed in → redirect to /login (via the root route context).
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: unknown }).user;
    if (!user) {
      throw redirect({ to: '/login' });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  // Branding (admin > Paramètres) — same query as the sidebar and the auth
  // pages; __root.tsx's SSR fetchQuery already primed the ['branding'] cache.
  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => getBrandingFn(),
  });

  return (
    // TooltipProvider required by the sidebar tooltips (SidebarMenuButton
    // tooltip=...) — the CLI-generated sidebar.tsx does not embed it.
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <AppShell
          header={
            <span className="text-sm font-medium text-muted-foreground">
              {brandingQuery.data?.appName ?? 'Mojito Panel'}
            </span>
          }
        >
          <Outlet />
        </AppShell>
      </SidebarProvider>
    </TooltipProvider>
  );
}
