import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AppShell } from '~/components/app-shell';
import { AppSidebar } from '~/components/app-sidebar';
import { SidebarProvider } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { ServerProvider, useServer } from '~/contexts/use-server';

/**
 * Server layout (Pelican-style /server/{uuid}) — TOP-LEVEL route: it does NOT
 * nest under the dashboard layout (_app), but shares the consolidated
 * AppSidebar. The ServerProvider owns the two shared queries (DB detail +
 * live runtime); the sidebar, the AppShell header and every child page read
 * them through `useServer()` instead of prop-drilling or re-declaring the
 * query.
 */
export const Route = createFileRoute('/servers/$serverId')({
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw redirect({ to: '/login' });
    }
  },
  component: ServerLayout,
});

function ServerLayout() {
  const { serverId } = Route.useParams();

  return (
    <ServerProvider serverId={serverId}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <ServerHeaderShell />
        </SidebarProvider>
      </TooltipProvider>
    </ServerProvider>
  );
}

/**
 * AppShell + top bar — a CHILD of the provider because it reads the shared
 * queries from the context (the layout itself sits above the provider).
 */
function ServerHeaderShell() {
  const snapshot = useServer();

  return (
    <AppShell
      header={
        <>
          <span className="text-sm font-medium">{snapshot?.server?.name ?? '…'}</span>
          <span className="text-muted-foreground text-sm">
            · {snapshot?.server?.recipe?.name ?? ''}
          </span>
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}
