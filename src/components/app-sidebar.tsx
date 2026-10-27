import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  CalendarClock,
  FolderOpen,
  HeartPulse,
  History,
  KeyRound,
  LayoutDashboard,
  Network,
  Puzzle,
  Rocket,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Terminal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ServerStatus } from '~/contract';
import { StatusBall, statusLabel } from '~/components/status-badge';
import { userServersList } from '~/lists/user-servers';
import { SidebarUserMenu } from '~/components/user-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '~/components/ui/sidebar';
import { Skeleton } from '~/components/ui/skeleton';
import { getBrandingFn } from '~/server/functions/settings';
import { useAuth } from '~/contexts/use-auth';
import {
  canFromPermissions,
  hasAdminAreaAccess,
  serverCan,
  type PermissionRequest,
} from '~/lib/permissions';

/** Panel-side status (contract status + the install_failed state). */
export type PanelServerStatus = ServerStatus | 'install_failed';

/**
 * Server navigation — Pelican-style tabs. `soon` marks the pages that are
 * still placeholders (roadmap view). `permission` gates the tab: it is
 * only shown when the viewer's per-server grant carries it (sub-users see
 * a restricted set, owners/admins see everything).
 */
const serverItems: Array<{
  title: string;
  url: string;
  icon: LucideIcon;
  soon: boolean;
  permission?: PermissionRequest;
}> = [
  { title: 'Console', url: '/servers/$serverId/console', icon: Terminal, soon: false, permission: { 'server.console': ['read'] } },
  { title: 'Fichiers', url: '/servers/$serverId/files', icon: FolderOpen, soon: false, permission: { 'server.files': ['read'] } },
  { title: 'Planifications', url: '/servers/$serverId/schedules', icon: CalendarClock, soon: false, permission: { 'server.schedules': ['read'] } },
  { title: 'Utilisateurs', url: '/servers/$serverId/users', icon: Users, soon: false, permission: { 'server.users': ['read'] } },
  { title: 'Sauvegardes', url: '/servers/$serverId/backups', icon: Archive, soon: false, permission: { 'server.backups': ['read'] } },
  { title: 'Réseau', url: '/servers/$serverId/network', icon: Network, soon: false, permission: { 'server.network': ['read'] } },
  { title: 'Variables', url: '/servers/$serverId/variables', icon: Rocket, soon: false, permission: { 'server.variables': ['read'] } },
  { title: 'Paramètres', url: '/servers/$serverId/settings', icon: Settings, soon: false, permission: { 'server.settings': ['read'] } },
  { title: 'Activité', url: '/servers/$serverId/activity', icon: History, soon: false, permission: { 'server.activity': ['read'] } },
];

/**
 * Administration menu — Pelican admin parity. `soon` marks the pages that
 * are still placeholders (roadmap view). `permission` gates the item: it
 * is only shown when the session user's effective permissions (built-in
 * or custom role) carry the matching statement.
 */
const adminItems: Array<{
  title: string;
  url: string;
  icon: LucideIcon;
  soon: boolean;
  permission: PermissionRequest;
}> = [
  { title: 'Vue d’ensemble', url: '/admin', icon: LayoutDashboard, soon: false, permission: { 'panel.overview': ['read'] } },
  { title: 'Serveurs', url: '/admin/servers', icon: Server, soon: false, permission: { 'panel.servers': ['read'] } },
  { title: 'Nodes', url: '/admin/nodes', icon: Network, soon: false, permission: { 'panel.nodes': ['read'] } },
  { title: 'Recettes', url: '/admin/recipes', icon: Puzzle, soon: false, permission: { 'panel.recipes': ['read'] } },
  { title: 'Utilisateurs', url: '/admin/users', icon: Users, soon: false, permission: { user: ['list'] } },
  { title: 'Rôles', url: '/admin/roles', icon: ShieldCheck, soon: false, permission: { 'panel.roles': ['read'] } },
  { title: 'API', url: '/admin/api', icon: KeyRound, soon: true, permission: { 'panel.overview': ['read'] } },
  { title: 'Paramètres', url: '/admin/settings', icon: Settings, soon: false, permission: { 'panel.settings': ['read'] } },
  { title: 'Santé', url: '/admin/health', icon: HeartPulse, soon: false, permission: { 'panel.overview': ['read'] } },
  { title: 'Activité', url: '/admin/activity', icon: History, soon: false, permission: { 'panel.servers': ['read'] } },
];

interface NavItemProps {
  title: string;
  url: string;
  icon: LucideIcon;
  soon: boolean;
  params?: Record<string, string>;
}

/** One sidebar navigation entry — link + optional "à venir" roadmap dot. */
function NavItem({ title, url, icon: Icon, soon, params }: NavItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={title} render={<Link to={url} params={params} />}>
        <Icon />
        <span>{title}</span>
        {soon && (
          <span
            title="À venir"
            className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-400 group-data-[collapsible=icon]:hidden"
          />
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * Server context of the single-server variant (name, status, permissions).
 * The flags keep the layout decoupled from the queries: `nameLoaded` /
 * `permissionsLoaded` mark the DB detail query, `statusLoaded` the live
 * runtime query — the sidebar shows skeletons for whatever is in flight.
 */
interface ServerContext {
  id: string;
  name?: string;
  /** Last-known (DB) status — shown until the live status arrives. */
  status?: PanelServerStatus;
  /** True while the live agent status query is in flight. */
  statusFetching?: boolean;
  /** Viewer's per-server permissions (flat list) — sub-users see fewer tabs. */
  permissions?: string[];
  /** False while the DB detail query is in flight → skeleton menu. */
  permissionsLoaded?: boolean;
}

interface AppSidebarProps {
  /** Navigation set: dashboard (default) or the Pelican-style admin area. */
  variant?: 'dashboard' | 'admin';
  /** Present → single-server layout: server header + tabs (overrides variant). */
  server?: ServerContext;
}

/**
 * Consolidated application sidebar — ONE sidebar for every layout:
 * dashboard, /admin and the single-server pages. The header shows the
 * branding (admin > Paramètres, prefetched in __root.tsx) or the server
 * name + status; the footer is ALWAYS the user menu (theme preference +
 * logout), so the account controls live in the same place everywhere.
 */
export function AppSidebar({ variant = 'dashboard', server }: AppSidebarProps) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => getBrandingFn(),
  });

  const inServer = server !== undefined;
  const serverParams = server ? { serverId: server.id } : undefined;
  const visibleServerItems = serverItems.filter(
    (item) => !item.permission || serverCan(server?.permissions ?? [], item.permission),
  );
  const visibleAdminItems = adminItems.filter(
    (item) => canFromPermissions(permissions, item.permission),
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {server ? (
              <SidebarMenuButton
                size="lg"
                render={<Link to="/servers/$serverId/console" params={{ serverId: server.id }} />}
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Server className="size-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                  <span className="truncate font-semibold">{server.name ?? '…'}</span>
                  {server.statusFetching ? (
                    <Skeleton className="h-3 w-16" />
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusBall status={server.status ?? 'unknown'} />
                      {statusLabel(server.status ?? 'unknown')}
                    </span>
                  )}
                </div>
              </SidebarMenuButton>
            ) : (
              <SidebarMenuButton size="lg" render={<Link to="/servers" search={userServersList.defaultSearch} />}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {variant === 'admin' ? (
                    <Shield className="size-4" />
                  ) : (
                    <Server className="size-4" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">
                    {variant === 'admin'
                      ? 'Administration'
                      : (brandingQuery.data?.appName ?? 'Mojito Panel')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {variant === 'admin' ? 'Infrastructure' : 'Serveurs de jeux'}
                  </span>
                </div>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {inServer ? (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItem
                    title="Mes serveurs"
                    url="/servers"
                    icon={LayoutDashboard}
                    soon={false}
                  />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>{server.name ?? 'Serveur'}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {server.permissionsLoaded ? (
                    visibleServerItems.map((item) => (
                      <NavItem
                        key={item.title}
                        title={item.title}
                        url={item.url}
                        icon={item.icon}
                        soon={item.soon}
                        params={serverParams}
                      />
                    ))
                  ) : (
                    // Per-server grants unknown yet → the FULL menu as
                    // skeletons, never a filtered flash of tabs
                    serverItems.map((item) => (
                      <SidebarMenuSkeleton key={item.title} showIcon />
                    ))
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {canFromPermissions(permissions, { 'panel.servers': ['read'] }) && (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <NavItem
                      title="Ouvrir dans l’admin"
                      url="/admin/servers/$serverId"
                      icon={Shield}
                      soon={false}
                      params={serverParams}
                    />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        ) : variant === 'admin' ? (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>Administration</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleAdminItems.map((item) => (
                    <NavItem
                      key={item.url}
                      title={item.title}
                      url={item.url}
                      icon={item.icon}
                      soon={item.soon}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItem
                    title="Mes serveurs"
                    url="/servers"
                    icon={LayoutDashboard}
                    soon={false}
                  />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItem
                    title="Mes serveurs"
                    url="/servers"
                    icon={Server}
                    soon={false}
                  />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {hasAdminAreaAccess(permissions) && (
              <SidebarGroup>
                <SidebarGroupLabel>Administration</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <NavItem
                      title="Administration"
                      url="/admin"
                      icon={Shield}
                      soon={false}
                    />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
