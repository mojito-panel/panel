import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { SidebarProvider } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { ServerSidebar, type PanelServerStatus } from '~/components/server-sidebar';
import { AppShell } from '~/components/app-shell';
import { getServerFn } from '~/server/functions/servers';

/**
 * Server layout (Pelican-style /server/{uuid}) — TOP-LEVEL route: it does NOT
 * nest under the dashboard layout (_app), it has its OWN sidebar (Console,
 * Settings…). Server data is cached under ['server', serverId] and shared
 * with the child pages.
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
        <ServerSidebar name={server?.name} status={status} />
        <AppShell
          header={
            <>
              <span className="text-sm font-medium">{server?.name ?? '…'}</span>
              {status && (
                <span
                  className={
                    status === 'running'
                      ? 'rounded-full bg-green-100 px-3 py-1 text-xs text-green-700'
                      : status === 'crashed' || status === 'install_failed'
                        ? 'rounded-full bg-red-100 px-3 py-1 text-xs text-red-700'
                        : 'rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground'
                  }
                >
                  {status}
                </span>
              )}
            </>
          }
        >
          <Outlet />
        </AppShell>
      </SidebarProvider>
    </TooltipProvider>
  );
}
