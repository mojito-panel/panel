import { Link, useParams } from '@tanstack/react-router';
import { Terminal, Settings, Server } from 'lucide-react';
import type { ServerStatus } from '@mojito/contract';

/** Panel-side status (contract status + the install_failed state). */
export type PanelServerStatus = ServerStatus | 'install_failed';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '~/components/ui/sidebar';

/** Server navigation — Pelican-style tabs (V1: console + settings). */
const serverItems = [
  { title: 'Console', url: '/servers/$serverId/console', icon: Terminal },
  { title: 'Paramètres', url: '/servers/$serverId/settings', icon: Settings },
];

/** Status dot colors (same palette as the console header badge). */
function statusClass(status: PanelServerStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'bg-green-500';
    case 'crashed':
    case 'install_failed':
      return 'bg-destructive';
    default:
      return 'bg-muted-foreground';
  }
}

interface ServerSidebarProps {
  name?: string;
  status?: PanelServerStatus;
}

/**
 * Sidebar of a single server (layout /servers/$serverId) — server name +
 * status at the top, navigation tabs below, back-to-dashboard link at the
 * bottom. Mirrors the Pelican server layout.
 */
export function ServerSidebar({ name, status }: ServerSidebarProps) {
  const params = useParams({ from: '/servers/$serverId' });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/servers/$serverId/console" params={params}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Server className="size-4" />
                </div>
                <div className="flex min-w-0 flex-col gap-0.5 leading-none">
                  <span className="truncate font-semibold">{name ?? '…'}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`size-2 shrink-0 rounded-full ${statusClass(status)}`} />
                    {status ?? '…'}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {serverItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link to={item.url} params={params}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Mes serveurs">
              <Link to="/servers">
                <span>← Mes serveurs</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
