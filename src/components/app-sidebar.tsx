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
  { title: 'Marketplace', url: '/admin/marketplace', icon: Store, soon: false, permission: { 'panel.recipes': ['read'] } },
  { title: 'Clés SSH', url: '/admin/keys', icon: KeySquare, soon: false, permission: { 'panel.keys': ['read'] } },
  { title: 'Utilisateurs', url: '/admin/users', icon: Users, soon: false, permission: { user: ['list'] } },
  { title: 'Rôles', url: '/admin/roles', icon: ShieldCheck, soon: false, permission: { 'panel.roles': ['read'] } },
  { title: 'API', url: '/admin/api', icon: KeyRound, soon: true, permission: { 'panel.overview': ['read'] } },
  { title: 'Paramètres', url: '/admin/settings', icon: Settings, soon: false, permission: { 'panel.settings': ['read'] } },
  { title: 'Santé', url: '/admin/health', icon: HeartPulse, soon: false, permission: { 'panel.overview': ['read'] } },
  { title: 'Jobs', url: '/admin/jobs', icon: ListTodo, soon: false, permission: { 'panel.overview': ['read'] } },
  { title: 'Activité', url: '/admin/activity', icon: History, soon: false, permission: { 'panel.activity': ['read'] } },
];

interface NavItemProps {
  title: string;
  url: string;
  icon: LucideIcon;
  soon: boolean;
  params?: Record<string, string>;
  /** Attention dot — e.g. the recipe was updated after the server's snapshot. */
  dot?: boolean;
  /** Count pill — pre-formatted (e.g. "2 / 5" backups, "3" schedules). */
  badge?: string;
}

/** One sidebar navigation entry — link + optional "à venir" dot / count badge. */
function NavItem({ title, url, icon: Icon, soon, params, dot, badge }: NavItemProps) {
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
        {dot && !soon && (
          <span
            title="Recette mise à jour — recharge-la depuis les paramètres"
            className="relative ml-auto flex size-2 shrink-0 group-data-[collapsible=icon]:hidden"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex size-2 shrink-0 rounded-full bg-sky-500" />
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
                      <StatusBall status={server?.status ?? 'unknown'} live={snapshot.statusLive} />
                      {statusLabel(server?.status ?? 'unknown')}
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
                    soon={false}
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
                        soon={item.soon}
                        params={serverParams}
                        dot={
                          item.url === '/servers/$serverId/variables' &&
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
