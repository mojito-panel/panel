import { Link } from '@tanstack/react-router';
import {
  Network,
  Puzzle,
  Shield,
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

/**
 * Administration menu — Pelican admin parity. `soon` marks the pages that
 * are still placeholders (roadmap view).
 */
const adminItems = [
  { title: 'Vue d’ensemble', url: '/admin', icon: LayoutDashboard, soon: false },
  { title: 'Serveurs', url: '/admin/servers', icon: Server, soon: true },
  { title: 'Nodes', url: '/admin/nodes', icon: Network, soon: false },
  { title: 'Plugins', url: '/admin/plugins', icon: Puzzle, soon: false },
  { title: 'Utilisateurs', url: '/admin/users', icon: Users, soon: true },
  { title: 'API', url: '/admin/api', icon: KeyRound, soon: true },
  { title: 'Paramètres', url: '/admin/settings', icon: Settings, soon: true },
  { title: 'Santé', url: '/admin/health', icon: HeartPulse, soon: true },
] as const;

/**
 * Sidebar of the admin layout (/admin/*) — clearly separate from the
 * dashboard, like the Pelican admin area.
 */
export function AdminSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/admin">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Shield className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Administration</span>
                  <span className="text-xs text-muted-foreground">Infrastructure</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <Link to={item.url}>
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
                <LayoutDashboard />
                <span>Mes serveurs</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
