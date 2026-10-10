import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { AppSidebar } from '~/components/app-sidebar';

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
  return (
    // TooltipProvider required by the sidebar tooltips (SidebarMenuButton
    // tooltip=...) — the CLI-generated sidebar.tsx does not embed it.
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-medium text-muted-foreground">Mojito Panel</span>
          </header>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
