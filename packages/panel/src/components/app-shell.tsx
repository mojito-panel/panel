import type { ReactNode } from 'react';
import { SidebarInset, SidebarTrigger } from '~/components/ui/sidebar';

/**
 * Shared shell for all sidebar layouts (dashboard, admin, server): top bar
 * with trigger + the page content container. The container width (max-w-7xl,
 * padding) lives HERE — routes must NOT define their own max-width.
 */
export function AppShell({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <SidebarInset>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        {header}
      </header>
      {/* div (not main): SidebarInset already renders a <main> element */}
      <div className="mx-auto w-full max-w-7xl flex-1 p-8">{children}</div>
    </SidebarInset>
  );
}
