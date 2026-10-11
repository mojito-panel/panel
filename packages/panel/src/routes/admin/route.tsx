import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { SidebarProvider } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { AdminSidebar } from '~/components/admin-sidebar';
import { AppShell } from '~/components/app-shell';
import { hasAdminAreaAccess } from '~/lib/permissions';

/**
 * Admin layout — SEPARATE sidebar from the dashboard (Pelican-style admin
 * area). Guard: signed-in users with at least one panel-level permission
 * (admin OR moderator role); others are redirected to their servers.
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } | null }).user;
    if (!user) {
      throw redirect({ to: '/login' });
    }
    if (!hasAdminAreaAccess(user.permissions ?? [])) {
      throw redirect({ to: '/servers' });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar />
        <AppShell
          header={
            <span className="text-sm font-medium text-muted-foreground">
              Administration
            </span>
          }
        >
          <Outlet />
        </AppShell>
      </SidebarProvider>
    </TooltipProvider>
  );
}
