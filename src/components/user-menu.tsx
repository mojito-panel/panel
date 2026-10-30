import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, LogOut, Monitor, MoonStar, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '~/components/ui/sidebar';
import { UserAvatar } from '~/components/user-avatar';
import { useAuth } from '~/contexts/use-auth';
import { getBrandingFn } from '~/server/functions/settings';

/** Theme options of the user menu — values are next-themes themes. */
const themeOptions = [
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: MoonStar },
  { value: 'system', label: 'Système', icon: Monitor },
] as const;

/**
 * Sidebar footer user button — shared by every layout (dashboard, admin,
 * server). Opens a menu with the theme preference (light / dark / system,
 * persisted by next-themes) and the logout action. The avatar mode
 * (Gravatar) comes from the branding settings, prefetched in __root.tsx
 * (queryKey ['branding']).
 */
export function SidebarUserMenu() {
  const { user, useSignOut } = useAuth();
  const signOut = useSignOut();
  const { theme = 'system', setTheme } = useTheme();
  const { isMobile } = useSidebar();

  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => getBrandingFn(),
  });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              >
                <UserAvatar
                  name={user?.name}
                  email={user?.email}
                  gravatar={brandingQuery.data?.gravatar ?? false}
                  className="size-8 shrink-0"
                />
                <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-semibold">{user?.name}</span>
                  <span className="text-muted-foreground truncate text-xs">{user?.email}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent side={isMobile ? 'bottom' : 'top'} align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Thème</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                {themeOptions.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    <option.icon />
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut.mutate()} disabled={signOut.isPending}>
              <LogOut />
              Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
