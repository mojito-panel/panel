import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { AdminSidebar } from '~/components/admin-sidebar';

/**
 * Admin layout — SEPARATE sidebar from the dashboard (Pelican-style admin
 * area). Guard: signed-in admin only; users are redirected to their servers.
 */
export const Route = createFileRoute('/admin')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { role?: string } | null }).user;
    if (!user) {
      throw redirect({ to: '/login' });
    }
    if (user.role !== 'admin') {
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
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-medium text-muted-foreground">
              Administration
            </span>
          </header>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
