import type { ReactNode } from 'react';

import { SidebarInset, SidebarTrigger } from '~/components/ui/sidebar';
import { cn } from '~/lib/utils';

/**
 * Shared shell for all sidebar layouts (dashboard, admin, server): top bar
 * with trigger + the page content container. The container width (max-w-7xl,
 * padding) lives HERE — routes must NOT define their own max-width. Pages
 * that need the full available width (e.g. the marketplace cover-card
 * grids) opt in with `wide`, passed by their section layout.
 */
export function AppShell({
  header,
  wide = false,
  children,
}: {
  header: ReactNode;
  /** Drop the max-w-7xl cap — the content spans the full available width. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <SidebarInset>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        {header}
      </header>
      {/* div (not main): SidebarInset already renders a <main> element */}
      <div className={cn('mx-auto w-full flex-1 p-8', !wide && 'max-w-7xl')}>{children}</div>
    </SidebarInset>
  );
}
