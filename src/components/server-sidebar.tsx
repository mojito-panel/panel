import { Link, useParams } from '@tanstack/react-router';
import {
  Terminal,
  Settings,
  Server,
  FolderOpen,
  CalendarClock,
  Users,
  Archive,
  Network,
  Rocket,
  History,
} from 'lucide-react';
import type { ServerStatus } from '~/contract';

/** Panel-side status (contract status + the install_failed state). */
export type PanelServerStatus = ServerStatus | 'install_failed';
import { StatusBall, statusLabel } from '~/components/status-badge';
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
import { serverCan, type PermissionRequest } from '~/lib/permissions';

/**
 * Server navigation — Pelican-style tabs. `soon` marks the pages that are
 * still placeholders (roadmap view). `permission` gates the tab: it is
 * only shown when the viewer's per-server grant carries it (sub-users see
 * a restricted set, owners/admins see everything).
 */
const serverItems: Array<{
  title: string;
  url: string;
  icon: typeof Terminal;
  soon: boolean;
  permission?: PermissionRequest;
}> = [
  { title: 'Console', url: '/servers/$serverId/console', icon: Terminal, soon: false, permission: { 'server.console': ['read'] } },
  { title: 'Fichiers', url: '/servers/$serverId/files', icon: FolderOpen, soon: false, permission: { 'server.files': ['read'] } },
  { title: 'Planifications', url: '/servers/$serverId/schedules', icon: CalendarClock, soon: true },
  { title: 'Utilisateurs', url: '/servers/$serverId/users', icon: Users, soon: false, permission: { 'server.users': ['read'] } },
  { title: 'Sauvegardes', url: '/servers/$serverId/backups', icon: Archive, soon: true },
  { title: 'Réseau', url: '/servers/$serverId/network', icon: Network, soon: false, permission: { 'server.network': ['read'] } },
  { title: 'Variables', url: '/servers/$serverId/variables', icon: Rocket, soon: false, permission: { 'server.variables': ['read'] } },
  { title: 'Paramètres', url: '/servers/$serverId/settings', icon: Settings, soon: false, permission: { 'server.settings': ['read'] } },
  { title: 'Activité', url: '/servers/$serverId/activity', icon: History, soon: true },
];

interface ServerSidebarProps {
  name?: string;
  status?: PanelServerStatus;
  /** Viewer's per-server permissions (flat list) — sub-users see fewer tabs. */
  permissions?: string[];
}

/**
 * Sidebar of a single server (layout /servers/$serverId) — server name +
 * status at the top, navigation tabs below, back-to-dashboard link at the
 * bottom. Mirrors the Pelican server layout.
 */
export function ServerSidebar({ name, status, permissions = [] }: ServerSidebarProps) {
  const params = useParams({ from: '/servers/$serverId' });

  const items = serverItems.filter(
    (item) => !item.permission || serverCan(permissions, item.permission),
  );

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
                    <StatusBall status={status ?? 'unknown'} />
                    {status ? statusLabel(status) : '…'}
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
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link to={item.url} params={params}>
                      <item.icon />
                      <span>{item.title}</span>
                      {item.soon && (
                        <span
                          title="À venir"
                          className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-400 group-data-[collapsible=icon]:hidden"
                        />
                      )}
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
