import { Link } from '@tanstack/react-router';
import {
  Network,
  Puzzle,
  Shield,
  ShieldCheck,
  LayoutDashboard,
  Server,
  Users,
  KeyRound,
  Settings,
  HeartPulse,
} from 'lucide-react';
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
} from '~/components/ui/sidebar';
import { useAuth } from '~/contexts/use-auth';
import { canFromPermissions } from '~/lib/permissions';

/**
 * Administration menu — Pelican admin parity. `soon` marks the pages that
 * are still placeholders (roadmap view). `permission` gates the item:
 * it is only shown when the session user's effective permissions (built-in
 * or custom role) carry the matching statement.
 */
const adminItems = [
  { title: 'Vue d’ensemble', url: '/admin', icon: LayoutDashboard, soon: false, permission: { 'panel.overview': ['read'] } },
  { title: 'Serveurs', url: '/admin/servers', icon: Server, soon: true, permission: { 'panel.servers': ['read'] } },
  { title: 'Nodes', url: '/admin/nodes', icon: Network, soon: false, permission: { 'panel.nodes': ['read'] } },
  { title: 'Recettes', url: '/admin/recipes', icon: Puzzle, soon: false, permission: { 'panel.recipes': ['read'] } },
  { title: 'Utilisateurs', url: '/admin/users', icon: Users, soon: false, permission: { user: ['list'] } },
  { title: 'Rôles', url: '/admin/roles', icon: ShieldCheck, soon: false, permission: { 'panel.roles': ['read'] } },
  { title: 'API', url: '/admin/api', icon: KeyRound, soon: true, permission: { 'panel.overview': ['read'] } },
  { title: 'Paramètres', url: '/admin/settings', icon: Settings, soon: true, permission: { 'panel.overview': ['read'] } },
  { title: 'Santé', url: '/admin/health', icon: HeartPulse, soon: false, permission: { 'panel.overview': ['read'] } },
] as const;

/** Status badge colors are centralized in status-badge.tsx. */

/**
 * Sidebar of the admin layout (/admin/*) — clearly separate from the
 * dashboard, like the Pelican admin area. Items are filtered by the
 * current user's panel permissions.
 */
export function AdminSidebar() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const items = adminItems.filter(
    (item) => !item.permission || canFromPermissions(permissions, item.permission),
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/admin" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Shield className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">Administration</span>
                <span className="text-xs text-muted-foreground">Infrastructure</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton tooltip={item.title} render={<Link to={item.url} />}>
                    <item.icon />
                    <span>{item.title}</span>
                    {item.soon && (
                      <span
                        title="À venir"
                        className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-400 group-data-[collapsible=icon]:hidden"
                      />
                    )}
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
            <SidebarMenuButton tooltip="Mes serveurs" render={<Link to="/servers" />}>
              <LayoutDashboard />
              <span>Mes serveurs</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
