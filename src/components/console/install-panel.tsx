import { useEffect, useRef } from 'react';

import { Loader2, RefreshCw } from 'lucide-react';

import type { InstallLogLine } from '~/contract';

import { Button } from '~/components/ui/button';

import { renderInstallLine } from './messages';

/** Minimal shape shared by the WS status (ConsoleInstallStatus) and the polled one (InstallStatus). */
export interface InstallNoticeStatus {
  status: 'installing' | 'installed' | 'failed';
}

interface InstallNoticeProps {
  /** Live install status (null = pending, the WS has not pushed yet). */
  status: InstallNoticeStatus | null;
  /** Retry callback — undefined hides the button (no server.settings.update). */
  onRetry?: () => void;
  retryPending: boolean;
  retryError: string | null;
}

/**
 * Slim install notice — replaces the old progress banner: the steps stream
 * below (console in WS mode, log box in polling mode), so a one-line message
 * is enough, plus the retry action when the install fails (the error itself
 * is already in the console).
 */
export function InstallNotice({ status, onRetry, retryPending, retryError }: InstallNoticeProps) {
  if (status?.status === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
        <span>Échec de l'installation</span>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retryPending}>
            <RefreshCw className={retryPending ? 'animate-spin' : undefined} />
            {retryPending ? 'Nouvelle tentative…' : 'Réessayer'}
          </Button>
        )}
        {retryError && <span>{retryError}</span>}
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Installation en cours — suivez la progression ci-dessous.
    </p>
  );
}

interface InstallLogsProps {
  logs: InstallLogLine[];
}

/** HH:MM:SS of an ISO timestamp (log lines). */
function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR');
}

/** Log line color: one color for every step, gray for the logs that follow. */
function lineClass(line: InstallLogLine): string {
  if (line.level === 'error') return 'text-red-400';
  if (line.level === 'step') return 'text-yellow-400';
  if (line.code === 'install.done') return 'text-green-400';
  return 'text-neutral-400';
}

/**
 * Install step logs — polling fallback only: the console polls the server's
 * runtime logs, which stay empty during an install, so the steps render here.
 * A blank line separates each step.
 */
export function InstallLogs({ logs }: InstallLogsProps) {
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the log scrolled to the newest line
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  // A blank line at the end of each step (before the next step starts).
  const rows: { line: InstallLogLine; gapBefore: boolean }[] = [];
  let stepsSeen = 0;
  for (const line of logs) {
    const gapBefore = line.level === 'step' && stepsSeen > 0;
    if (line.level === 'step') stepsSeen++;
    rows.push({ line, gapBefore });
  }

  return (
    <div
      ref={logRef}
      className="max-h-80 overflow-y-auto rounded-md bg-black p-3 font-mono text-xs leading-relaxed text-neutral-200"
    >
      {rows.length === 0 ? (
        <p className="text-neutral-500">Waiting for the first log…</p>
      ) : (
        rows.map(({ line, gapBefore }, i) => (
          <div key={i}>
            {gapBefore && <div className="h-3" aria-hidden="true" />}
            <p className={lineClass(line)}>
              <span className="text-neutral-500">[{shortTime(line.timestamp)}] </span>
              {renderInstallLine(line)}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
