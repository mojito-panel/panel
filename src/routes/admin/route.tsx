import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router';

import { AppShell } from '~/components/app-shell';
import { AppSidebar } from '~/components/app-sidebar';
import { SidebarProvider } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { hasAdminAreaAccess } from '~/lib/permissions';
import { userServersList } from '~/lists/user-servers';

/**
 * Admin layout — Pelican-style admin area. Same consolidated sidebar as
 * the dashboard (admin item set + user menu footer). Guard: signed-in
 * users with at least one panel-level permission (admin OR moderator
 * role); others are redirected to their servers.
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } | null }).user;
    if (!user) {
      throw redirect({ to: '/login' });
    }
    if (!hasAdminAreaAccess(user.permissions ?? [])) {
      throw redirect({ to: '/servers', search: userServersList.defaultSearch });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  // The marketplace pages (Steam-style cover-card grids) span the full
  // available width — AppShell drops its max-w-7xl cap for them alone.
  const wide = useRouterState({
    select: (state) => state.location.pathname.startsWith('/admin/marketplace'),
  });

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar variant="admin" />
        <AppShell
          wide={wide}
          header={<span className="text-muted-foreground text-sm font-medium">Administration</span>}
        >
          <Outlet />
        </AppShell>
      </SidebarProvider>
    </TooltipProvider>
  );
}
