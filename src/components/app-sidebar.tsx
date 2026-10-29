import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  CalendarClock,
  FolderOpen,
  HeartPulse,
  History,
  KeyRound,
  KeySquare,
  LayoutDashboard,
  Network,
  Puzzle,
  Rocket,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Store,
  Terminal,
  ListTodo,
  Users,
  type LucideIcon,
} from 'lucide-react';
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '~/components/ui/sidebar';
import { Skeleton } from '~/components/ui/skeleton';
import { getBrandingFn } from '~/server/functions/settings';
import { useAuth } from '~/contexts/use-auth';
import { useServer } from '~/contexts/use-server';
import {
  hasPermissions,
  hasAdminAreaAccess,
  hasServerPermissions,
  type PermissionRequest,
} from '~/lib/permissions';

/**
 * Server navigation — Pelican-style tabs. `permission` gates the tab: it is
 * only shown when the viewer's per-server grant carries it (sub-users see
 * a restricted set, owners/admins see everything).
 */
const serverItems: Array<{
  title: string;
  url: string;
  icon: LucideIcon;
  permission?: PermissionRequest;
}> = [
  { title: 'Console', url: '/servers/$serverId/console', icon: Terminal, permission: { 'server.console': ['read'] } },
  { title: 'Fichiers', url: '/servers/$serverId/files', icon: FolderOpen, permission: { 'server.files': ['read'] } },
  { title: 'Planifications', url: '/servers/$serverId/schedules', icon: CalendarClock, permission: { 'server.schedules': ['read'] } },
  { title: 'Utilisateurs', url: '/servers/$serverId/users', icon: Users, permission: { 'server.users': ['read'] } },
  { title: 'Sauvegardes', url: '/servers/$serverId/backups', icon: Archive, permission: { 'server.backups': ['read'] } },
  { title: 'Réseau', url: '/servers/$serverId/network', icon: Network, permission: { 'server.network': ['read'] } },
  { title: 'Variables', url: '/servers/$serverId/variables', icon: Rocket, permission: { 'server.variables': ['read'] } },
  { title: 'Paramètres', url: '/servers/$serverId/settings', icon: Settings, permission: { 'server.settings': ['read'] } },
  { title: 'Activité', url: '/servers/$serverId/activity', icon: History, permission: { 'server.activity': ['read'] } },
];

/**
 * Administration menu — Pelican admin parity. `permission` gates the item:
 * it is only shown when the session user's effective permissions (built-in
 * or custom role) carry the matching statement.
 */
const adminItems: Array<{
  title: string;
  url: string;
  icon: LucideIcon;
  permission: PermissionRequest;
}> = [
  { title: 'Vue d’ensemble', url: '/admin', icon: LayoutDashboard, permission: { 'panel.overview': ['read'] } },
  { title: 'Serveurs', url: '/admin/servers', icon: Server, permission: { 'panel.servers': ['read'] } },
  { title: 'Nodes', url: '/admin/nodes', icon: Network, permission: { 'panel.nodes': ['read'] } },
  { title: 'Recettes', url: '/admin/recipes', icon: Puzzle, permission: { 'panel.recipes': ['read'] } },
  { title: 'Marketplace', url: '/admin/marketplace', icon: Store, permission: { 'panel.recipes': ['read'] } },
  { title: 'Clés SSH', url: '/admin/keys', icon: KeySquare, permission: { 'panel.keys': ['read'] } },
  { title: 'Utilisateurs', url: '/admin/users', icon: Users, permission: { user: ['list'] } },
  { title: 'Rôles', url: '/admin/roles', icon: ShieldCheck, permission: { 'panel.roles': ['read'] } },
  { title: 'API', url: '/admin/api', icon: KeyRound, permission: { 'panel.overview': ['read'] } },
  { title: 'Paramètres', url: '/admin/settings', icon: Settings, permission: { 'panel.settings': ['read'] } },
  { title: 'Santé', url: '/admin/health', icon: HeartPulse, permission: { 'panel.overview': ['read'] } },
  { title: 'Jobs', url: '/admin/jobs', icon: ListTodo, permission: { 'panel.overview': ['read'] } },
  { title: 'Activité', url: '/admin/activity', icon: History, permission: { 'panel.activity': ['read'] } },
];

interface NavItemProps {
  title: string;
  url: string;
  icon: LucideIcon;
  params?: Record<string, string>;
  /** Attention dot — e.g. the recipe was updated after the server's snapshot. */
  dot?: boolean;
  /** Count pill — pre-formatted (e.g. "2 / 5" backups, "3" schedules). */
  badge?: string;
}

/** One sidebar navigation entry — link + optional dot / count badge. */
function NavItem({ title, url, icon: Icon, params, dot, badge }: NavItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={title} render={<Link to={url} params={params} />}>
        <Icon />
        <span>{title}</span>
        {dot && (
          <span
            title="Recette mise à jour — recharge-la depuis les paramètres"
            className="relative ml-auto flex size-2 shrink-0 items-center justify-center group-data-[collapsible=icon]:hidden"
          >
            {/* Halo kept INSIDE the button box: the menu button is
                overflow-hidden, so a growing animate-ping gets clipped. */}
            <span className="absolute inline-flex size-3.5 animate-pulse rounded-full bg-amber-400/40" />
            <span className="relative inline-flex size-2 shrink-0 rounded-full bg-amber-400" />
          </span>
        )}
      </SidebarMenuButton>
      {/* Kit badge — absolutely positioned against the item (a SIBLING of
          the button, per the shadcn structure); hides on icon collapse. */}
      {badge !== undefined && (
        <SidebarMenuBadge className="bg-sidebar-accent">{badge}</SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

/** Count pill text — "used / limit" when a limit applies, bare count otherwise. */
function countBadge(count: number, limit?: number): string {
  return limit !== undefined && limit > 0 ? `${count} / ${limit}` : String(count);
}

interface AppSidebarProps {
  /** Navigation set: dashboard (default) or the Pelican-style admin area. */
  variant?: 'dashboard' | 'admin';
}

/**
 * Consolidated application sidebar — ONE sidebar for every layout:
 * dashboard, /admin and the single-server pages. The header shows the
 * branding (admin > Paramètres, prefetched in __root.tsx) or the server
 * name + status; the footer is ALWAYS the user menu (theme preference +
 * logout), so the account controls live in the same place everywhere.
 *
 * The single-server variant is detected through the ServerProvider: its
 * presence (not the loaded data) marks the server layout, so the menu never
 * flashes the dashboard tabs while the detail query is in flight.
 */
export function AppSidebar({ variant = 'dashboard' }: AppSidebarProps) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => getBrandingFn(),
  });

  const snapshot = useServer();
  const server = snapshot?.server;
  const serverParams = snapshot ? { serverId: snapshot.serverId } : undefined;

  const visibleServerItems = serverItems.filter(
    (item) =>
      !item.permission ||
      hasServerPermissions(server?.viewer.permissions ?? [], item.permission),
  );
  const visibleAdminItems = adminItems.filter(
    (item) => hasPermissions(permissions, item.permission),
  );

  // Sidebar badges — backups "used / limit" (limit 0 = disabled → bare
  // count) and the number of cron schedules, read from the detail stats.
  const stats = server?.stats;
  const navBadges: Partial<Record<string, string>> = stats
    ? {
        '/servers/$serverId/backups': countBadge(stats.backups, stats.backupLimit),
        '/servers/$serverId/schedules': countBadge(stats.schedules),
      }
    : {};

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {snapshot ? (
              <SidebarMenuButton
                size="lg"
                render={<Link to="/servers/$serverId/console" params={{ serverId: snapshot.serverId }} />}
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Server className="size-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                  <span className="truncate font-semibold">{server?.name ?? '…'}</span>
                  {snapshot.statusFetching ? (
                    <Skeleton className="h-3 w-16" />
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusBall status={snapshot.status} live={snapshot.statusLive} />
                      {statusLabel(snapshot.status)}
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
        {snapshot ? (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItem
                    title="Mes serveurs"
                    url="/servers"
                    icon={LayoutDashboard}
                  />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>{server?.name ?? 'Serveur'}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {snapshot.isSuccess ? (
                    visibleServerItems.map((item) => (
                      <NavItem
                        key={item.title}
                        title={item.title}
                        url={item.url}
                        icon={item.icon}
                        params={serverParams}
                        dot={
                          item.url === '/servers/$serverId/settings' &&
                          snapshot.recipeUpdatePending
                        }
                        badge={navBadges[item.url]}
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
            {hasPermissions(permissions, { 'panel.servers': ['read'] }) && (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <NavItem
                      title="Ouvrir dans l’admin"
                      url="/admin/servers/$serverId"
                      icon={Shield}
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
