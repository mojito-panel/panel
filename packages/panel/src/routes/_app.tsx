import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { AppSidebar } from '~/components/app-sidebar';

/**
 * Layout des pages protégées — sidebar + contenu.
 * Non connecté → redirection vers /login (via le context du root route).
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
    // TooltipProvider requis par les tooltips du sidebar (SidebarMenuButton
    // tooltip=...) — le sidebar.tsx généré par le CLI ne l'embarque pas.
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
