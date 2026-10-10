import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { RefreshCw } from 'lucide-react';
import type { InstallStatus } from '@mojito/contract';
import { retryInstallFn } from '~/server/functions/servers';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

interface InstallPanelProps {
  serverId: string;
  /** Install status polled by the parent (console page). */
  status: InstallStatus;
}

/** HH:MM:SS of an ISO timestamp (log lines). */
function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR');
}

/**
 * Live install panel — shows each step as it runs, with the output of every
 * operation/command (stdout in white, stderr/errors in red), and a retry
 * button when the install failed. Replaces the console until the install
 * completes.
 */
export function InstallPanel({ serverId, status }: InstallPanelProps) {
  const queryClient = useQueryClient();
  const retryInstall = useServerFn(retryInstallFn);
  const logRef = useRef<HTMLDivElement>(null);

  const retry = useMutation({
    mutationFn: () => retryInstall({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['install-status', serverId] });
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
  });

  // Keep the log scrolled to the newest line
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [status.logs.length, status.status]);

  const failed = status.status === 'failed';
  const done = status.status === 'installed';

  return (
    <Card className={failed ? 'border-destructive/50' : undefined}>
      <CardHeader>
        <CardTitle>
          {failed
            ? 'Installation échouée'
            : done
              ? 'Installation terminée'
              : `Installation en cours… (étape ${Math.max(status.step, 1)}/${status.totalSteps || '…'})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.totalSteps > 0 && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{status.message}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${failed ? 'bg-destructive' : 'bg-green-500'}`}
                style={{ width: `${status.percent}%` }}
              />
            </div>
            <p className="text-right text-xs text-muted-foreground">{status.percent}%</p>
          </div>
        )}

        {failed && status.error && (
          <pre className="whitespace-pre-wrap rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {status.error}
          </pre>
        )}

        <div
          ref={logRef}
          className="max-h-80 overflow-y-auto rounded-md bg-black p-3 font-mono text-xs leading-relaxed text-neutral-200"
        >
          {status.logs.length === 0 ? (
            <p className="text-neutral-500">En attente du premier log…</p>
          ) : (
            status.logs.map((line, i) => (
              <p
                key={i}
                className={line.level === 'error' ? 'text-red-400' : undefined}
              >
                <span className="text-neutral-500">[{shortTime(line.timestamp)}] </span>
                {line.message}
              </p>
            ))
          )}
        </div>
      </CardContent>
      {failed && (
        <CardFooter>
          <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
            <RefreshCw className={retry.isPending ? 'animate-spin' : undefined} />
            {retry.isPending ? 'Relance…' : 'Réessayer l’installation'}
          </Button>
          {retry.isError && (
            <span className="ml-2 text-sm text-destructive">{retry.error.message}</span>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
