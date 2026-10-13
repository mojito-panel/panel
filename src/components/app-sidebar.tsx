import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Server, Shield, LogOut } from 'lucide-react';
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
import { UserAvatar } from '~/components/user-avatar';
import { getBrandingFn } from '~/server/functions/settings';
import { useAuth } from '~/contexts/use-auth';
import { hasAdminAreaAccess } from '~/lib/permissions';

/**
 * Application sidebar — main navigation + user footer. The header title and
 * the avatar mode (Gravatar) come from the branding settings (admin >
 * Paramètres), prefetched in __root.tsx (queryKey ['branding']).
 */
export function AppSidebar() {
  const { user, useSignOut } = useAuth();
  const signOut = useSignOut();

  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => getBrandingFn(),
  });
  const branding = brandingQuery.data;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/servers" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Server className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">{branding?.appName ?? 'Mojito Panel'}</span>
                <span className="text-xs text-muted-foreground">
                  Serveurs de jeux
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Mes serveurs" render={<Link to="/servers" />}>
                  <Server />
                  <span>Mes serveurs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user && hasAdminAreaAccess(user.permissions) && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Administration" render={<Link to="/admin" />}>
                    <Shield />
                    <span>Administration</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:p-0">
              <UserAvatar
                name={user?.name}
                email={user?.email}
                gravatar={branding?.gravatar ?? false}
                className="size-8 shrink-0"
              />
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <SidebarMenuButton
                tooltip="Se déconnecter"
                onClick={() => signOut.mutate()}
                disabled={signOut.isPending}
                className="group-data-[collapsible=icon]:flex"
              >
                <LogOut />
              </SidebarMenuButton>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
