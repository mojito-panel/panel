import { useEffect, useRef } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { getServerLogsFn } from '~/server/functions/servers';
import { Button } from '~/components/ui/button';

interface XtermConsoleProps {
  serverId: string;
  isRunning: boolean;
}

/**
 * Console serveur live : xterm.js alimenté par polling des logs
 * incrémentaux de l'agent (GET /servers/:id/logs?after=N).
 * Le terminal est créé dynamiquement dans useEffect (SSR-safe).
 */
export function XtermConsole({ serverId, isRunning }: XtermConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(0);
  const getLogs = useServerFn(getServerLogsFn);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let term: import('@xterm/xterm').Terminal | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const boot = async () => {
      const [{ Terminal }, { FitAddon: FitAddonClass }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      // CSS du terminal (une seule fois)
      if (!document.getElementById('xterm-css')) {
        const link = document.createElement('link');
        link.id = 'xterm-css';
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css';
        document.head.appendChild(link);
      }

      if (disposed || !containerRef.current) return;

      term = new Terminal({
        convertEol: true,
        fontSize: 13,
        scrollback: 5000,
        disableStdin: true,
        theme: { background: '#0d1117' },
      });
      const fit = new FitAddonClass();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      resizeObserver = new ResizeObserver(() => fit.fit());
      resizeObserver.observe(containerRef.current);

      const poll = async () => {
        try {
          const chunk = await getLogs({ data: { serverId, after: cursorRef.current } });
          if (disposed || !term) return;
          if (chunk.lines.length > 0) {
            for (const line of chunk.lines) {
              term.writeln(line);
            }
          }
          cursorRef.current = chunk.next;
        } catch {
          // Agent injoignable — le prochain tick réessaiera
        }
      };

      await poll();
      pollTimer = setInterval(poll, 2000);
    };

    void boot();

    return () => {
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (resizeObserver) resizeObserver.disconnect();
      term?.dispose();
    };
  }, [serverId, getLogs]);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {isRunning
          ? 'Console live (rafraîchie toutes les 2 s)'
          : 'Console — le serveur est arrêté'}
      </p>
      <div
        ref={containerRef}
        className="min-h-[400px] overflow-hidden rounded-md border bg-[#0d1117] p-2"
      />
    </div>
  );
}
