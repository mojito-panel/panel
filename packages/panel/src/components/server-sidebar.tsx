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
import type { ServerStatus } from '@mojito/contract';

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

/**
 * Server navigation — Pelican-style tabs. `soon` marks the pages that are
 * still placeholders (roadmap view).
 */
const serverItems = [
  { title: 'Console', url: '/servers/$serverId/console', icon: Terminal, soon: false },
  { title: 'Fichiers', url: '/servers/$serverId/files', icon: FolderOpen, soon: false },
  { title: 'Planifications', url: '/servers/$serverId/schedules', icon: CalendarClock, soon: true },
  { title: 'Utilisateurs', url: '/servers/$serverId/users', icon: Users, soon: true },
  { title: 'Sauvegardes', url: '/servers/$serverId/backups', icon: Archive, soon: true },
  { title: 'Réseau', url: '/servers/$serverId/network', icon: Network, soon: true },
  { title: 'Variables', url: '/servers/$serverId/variables', icon: Rocket, soon: false },
  { title: 'Paramètres', url: '/servers/$serverId/settings', icon: Settings, soon: false },
  { title: 'Activité', url: '/servers/$serverId/activity', icon: History, soon: true },
] as const;

/** Status badge colors are centralized in status-badge.tsx. */

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
              {serverItems.map((item) => (
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
