import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { SidebarProvider } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { AppSidebar, type PanelServerStatus } from '~/components/app-sidebar';
import { StatusBadge } from '~/components/status-badge';
import { AppShell } from '~/components/app-shell';
import { getServerFn } from '~/server/functions/servers';

/**
 * Server layout (Pelican-style /server/{uuid}) — TOP-LEVEL route: it does NOT
 * nest under the dashboard layout (_app), but shares the consolidated
 * AppSidebar: server name + status in the header, the server tabs below,
 * the user menu (theme + logout) in the footer, like every other layout.
 * Server data is cached under ['server', serverId] and shared with the
 * child pages.
 */
export const Route = createFileRoute('/servers/$serverId')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: unknown }).user;
    if (!user) {
      throw redirect({ to: '/login' });
    }
  },
  component: ServerLayout,
});

function ServerLayout() {
  const { serverId } = Route.useParams();
  const getServer = useServerFn(getServerFn);

  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
  });

  const server = query.data;
  const status: PanelServerStatus | undefined = server?.status;

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          server={{
            id: serverId,
            name: server?.name,
            status,
            permissions: server?.viewer?.permissions,
          }}
        />
        <AppShell
          header={
            <>
              <span className="text-sm font-medium">{server?.name ?? '…'}</span>
              {status && <StatusBadge status={status} />}
            </>
          }
        >
          <Outlet />
        </AppShell>
      </SidebarProvider>
    </TooltipProvider>
  );
}
