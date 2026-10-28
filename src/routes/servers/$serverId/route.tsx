import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { SidebarProvider } from '~/components/ui/sidebar';
import { TooltipProvider } from '~/components/ui/tooltip';
import { AppSidebar, type PanelServerStatus } from '~/components/app-sidebar';
import { isLiveData } from '~/components/status-badge';
import { AppShell } from '~/components/app-shell';
import { getServerFn, getServerRuntimeFn } from '~/server/functions/servers';

/**
 * Server layout (Pelican-style /server/{uuid}) — TOP-LEVEL route: it does NOT
 * nest under the dashboard layout (_app), but shares the consolidated
 * AppSidebar: server name + status in the header, the server tabs below,
 * the user menu (theme + logout) in the footer, like every other layout.
 *
 * Two shared queries feed the layout and the child pages:
 * - ['server', serverId] — DB detail (name, recipe, grants): always fast,
 *   never waits on the agent;
 * - ['server-runtime', serverId] — LIVE agent status, best-effort (the DB
 *   status is served when the agent is unreachable).
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
  const getServer = useServerFn(getServerFn);
  const getRuntime = useServerFn(getServerRuntimeFn);

  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });

  const runtimeQuery = useQuery({
    queryKey: ['server-runtime', serverId],
    queryFn: () => getRuntime({ data: { serverId } }),
    refetchInterval: 5000,
  });

  const server = query.data;
  // LIVE status only — a stale DB status is never shown in the sidebar
  // (the runtime fn returns null when the agent is unreachable)
  const status: PanelServerStatus | undefined =
    runtimeQuery.data?.status ?? undefined;
  // Sonar rings while the agent answer is fresh (< 20 s) — a null status
  // (agent unreachable) is never live, whatever the fetch age.
  const statusLive = status !== undefined && isLiveData(runtimeQuery);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          server={{
            id: serverId,
            name: server?.name,
            status,
            statusLive,
            statusFetching: runtimeQuery.isPending,
            permissions: server?.viewer?.permissions,
            permissionsLoaded: query.isSuccess,
          }}
        />
        <AppShell
          header={
            <>
              <span className="text-sm font-medium">{server?.name ?? '…'}</span>
              <span className="text-sm text-muted-foreground">· {server?.recipe?.name ?? ''}</span>
            </>
          }
        >
          <Outlet />
        </AppShell>
      </SidebarProvider>
    </TooltipProvider>
  );
}
