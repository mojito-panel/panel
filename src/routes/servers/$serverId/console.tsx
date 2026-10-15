import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { useRef } from 'react';
import type { FormEvent } from 'react';
import { Play, Square, RotateCw, Skull, Send } from 'lucide-react';
import type {
  ConsoleClientMessage,
  ConsoleInstallStatus,
  ServerStatus,
} from '~/contract';
import type { PanelServerStatus } from '~/components/app-sidebar';
import {
  getServerFn,
  getServerRuntimeFn,
  getInstallStatusFn,
  retryInstallFn,
  serverActionFn,
  sendCommandFn,
} from '~/server/functions/servers';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { XtermConsole, type ConsoleMode } from '~/components/console/xterm-console';
import { InstallLogs, InstallNotice } from '~/components/console/install-panel';
import { ErrorState } from '~/components/error/error-state';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { serverCan } from '~/lib/permissions';

export const Route = createFileRoute('/servers/$serverId/console')({
  component: ServerConsolePage,
});

/** Caption of the console card (transport mode + install/runtime state). */
function consoleCaption(mode: ConsoleMode, installActive: boolean, isRunning: boolean): string {
  if (!installActive && !isRunning) return 'Console — le serveur est arrêté';
  if (installActive) {
    return mode === 'polling'
      ? 'Installation — rafraîchie toutes les 2 s (WS indisponible)'
      : 'Installation en cours — console en direct';
  }
  switch (mode) {
    case 'ws':
      return 'Console live (WebSocket direct agent)';
    case 'polling':
      return 'Console live (WS indisponible — rafraîchie toutes les 2 s)';
    default:
      return 'Connexion à la console…';
  }
}

function ServerConsolePage() {
  const { serverId } = Route.useParams();
  const queryClient = useQueryClient();
  const getServer = useServerFn(getServerFn);
  const getRuntime = useServerFn(getServerRuntimeFn);
  const doAction = useServerFn(serverActionFn);
  const sendCommand = useServerFn(sendCommandFn);
  const getInstallStatus = useServerFn(getInstallStatusFn);
  const retryInstall = useServerFn(retryInstallFn);

  const [command, setCommand] = useState('');
  // Transport of the console: 'ws' = live agent WS (installs stream over it),
  // 'polling' = degraded → fall back to the install status polling.
  const [consoleMode, setConsoleMode] = useState<ConsoleMode>('connecting');
  // Install status pushed by the agent over the WS (banner + DB sync trigger)
  const [installStatus, setInstallStatus] = useState<ConsoleInstallStatus | null>(null);
  // Live agent WS (set by XtermConsole): when connected, commands and power
  // actions go DIRECTLY to the agent (JWT-gated); otherwise via the panel.
  const wsSendRef = useRef<((message: ConsoleClientMessage) => void) | null>(null);

  const handleConsoleConnection = (
    send: ((message: ConsoleClientMessage) => void) | null,
  ) => {
    wsSendRef.current = send;
  };

  const handleConsoleStatus = (status: ServerStatus) => {
    // Runtime status pushed by the agent → refresh the queries (DB sync)
    void queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    void queryClient.invalidateQueries({ queryKey: ['server-runtime', serverId] });
  };

  // DB detail (name, grants) — never waits on the agent
  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });

  // LIVE agent status (best-effort — the DB status is served when the
  // agent is unreachable), polled like the old detail query
  const runtimeQuery = useQuery({
    queryKey: ['server-runtime', serverId],
    queryFn: () => getRuntime({ data: { serverId } }),
    refetchInterval: 5000,
  });

  // Install polling — FALLBACK ONLY (the direct WS streams installs live).
  // Used when the WS cannot be established, and once at the end to sync the
  // DB status (installing → stopped / install_failed).
  const installQuery = useQuery({
    queryKey: ['install-status', serverId],
    queryFn: () => getInstallStatus({ data: { serverId, after: 0 } }),
    enabled: consoleMode === 'polling',
    refetchInterval: (q) => (q.state.data?.status === 'installing' ? 800 : false),
  });

  // One-shot fetch on the terminal install states → syncs the DB status
  const syncInstallDb = useMutation({
    mutationFn: () => getInstallStatus({ data: { serverId, after: 0 } }),
  });

  const handleInstallStatus = (status: ConsoleInstallStatus) => {
    setInstallStatus(status);
    if (status.status === 'installed' || status.status === 'failed') {
      // The WS carries the live state; the panel DB still says 'installing'
      syncInstallDb.mutate();
      void queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      void queryClient.invalidateQueries({ queryKey: ['server-runtime', serverId] });
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    }
  };

  const retry = useMutation({
    mutationFn: () => retryInstall({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      // The agent replays the new install over the WS (reset) — status follows
      await queryClient.invalidateQueries({ queryKey: ['install-status', serverId] });
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      await queryClient.invalidateQueries({ queryKey: ['server-runtime', serverId] });
    },
  });

  const action = useMutation({
    mutationFn: (a: 'start' | 'stop' | 'restart' | 'kill') =>
      doAction({ data: { serverId, action: a } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['server-runtime', serverId] });
    },
  });

  const submitCommand = useMutation({
    mutationFn: (cmd: string) => sendCommand({ data: { serverId, command: cmd } }),
  });

  const [askKill, setAskKill] = useState(false);

  const runAction = (a: 'start' | 'stop' | 'restart' | 'kill') => {
    if (wsSendRef.current) {
      wsSendRef.current({ type: 'power', action: a });
      return;
    }
    action.mutate(a);
  };

  const server = query.data;
  // LIVE agent status only (null = agent unreachable) — a stale DB status
  // is never displayed here; the install detection below keeps its own
  // persisted fallback because installs are tracked in the DB.
  const status: PanelServerStatus | null | undefined = runtimeQuery.data?.status;
  const isRunning = status === 'running';
  // Process up (starting / running / stopping) — stop/kill make sense in
  // all three (a server stuck in "starting" must be stoppable), commands
  // reach the stdin of a live process.
  const isAlive = isRunning || status === 'starting' || status === 'stopping';

  // Per-server grants (sub-users) — hide what the viewer may not do. The
  // console JWT carries the same permissions: the agent refuses anyway.
  const permissions = server?.viewer?.permissions ?? [];
  const canStart = serverCan(permissions, { 'server.power': ['start'] });
  const canStop = serverCan(permissions, { 'server.power': ['stop'] });
  const canRestart = serverCan(permissions, { 'server.power': ['restart'] });
  const canKill = serverCan(permissions, { 'server.power': ['kill'] });
  const canCommand = serverCan(permissions, { 'server.console': ['command'] });
  const canRetryInstall = serverCan(permissions, { 'server.settings': ['update'] });

  // Install active: WS status first, persisted status while the WS has not
  // pushed yet (the DB is the source of truth for installs)
  const installActive = installStatus
    ? installStatus.status !== 'installed'
    : server?.status === 'installing' || server?.status === 'install_failed';

  const handleCommand = (e: FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    const cmd = command.trim();
    if (wsSendRef.current) {
      wsSendRef.current({ type: 'command', command: cmd });
    } else {
      submitCommand.mutate(cmd);
    }
    setCommand('');
  };

  // Degraded (polling) transport + install in progress → the console polls the
  // server's runtime logs (empty during an install), so the step logs render
  // here under the notice.
  if (consoleMode === 'polling' && installQuery.data && installQuery.data.status !== 'installed') {
    return (
      <div className="space-y-4">
        <InstallNotice
          status={installQuery.data}
          onRetry={canRetryInstall ? () => retry.mutate() : undefined}
          retryPending={retry.isPending}
          retryError={retry.isError ? retry.error.message : null}
        />
        <InstallLogs logs={installQuery.data.logs} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {query.isError && (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      )}
      {runtimeQuery.isError && (
        <ErrorState message={runtimeQuery.error.message} onRetry={() => runtimeQuery.refetch()} />
      )}
      {/* Status + grants still loading → the power buttons below simply stay
          hidden until the queries settle; the console card shows its own
          terminal-shaped skeleton (XtermConsole), no floating placeholder. */}
      {/* Live install — the steps stream into the console below, a one-line
          notice replaces the old progress banner */}
      {installActive && (
        <InstallNotice
          status={installStatus}
          onRetry={canRetryInstall ? () => retry.mutate() : undefined}
          retryPending={retry.isPending}
          retryError={retry.isError ? retry.error.message : null}
        />
      )}

      {/* Power actions — meaningless during an install */}
      {!installActive && (
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <Button
              onClick={() => runAction('start')}
              disabled={action.isPending || isAlive}
            >
              <Play />
              Démarrer
            </Button>
          )}
          {canStop && (
            <Button
              variant="secondary"
              onClick={() => runAction('stop')}
              disabled={action.isPending || !isAlive}
            >
              <Square />
              Arrêter
            </Button>
          )}
          {canRestart && (
            <Button
              variant="outline"
              onClick={() => runAction('restart')}
              disabled={action.isPending || !isAlive}
            >
              <RotateCw />
              Redémarrer
            </Button>
          )}
          {canKill && (
            <Button
              variant="destructive"
              onClick={() => setAskKill(true)}
              disabled={action.isPending || !isAlive}
            >
              <Skull />
              Kill
            </Button>
          )}
        </div>
      )}
      {action.isError && (
        <p className="text-sm text-destructive">{action.error.message}</p>
      )}

      {/* Console card — runtime logs AND install output (same WS, same terminal) */}
      <Card>
        <CardHeader>
          <CardTitle>Console</CardTitle>
          <CardDescription>{consoleCaption(consoleMode, installActive, isAlive)}</CardDescription>
        </CardHeader>
        <CardContent>
          <XtermConsole
            serverId={serverId}
            onConnection={handleConsoleConnection}
            onStatus={(message) => handleConsoleStatus(message.status)}
            onMode={setConsoleMode}
            onInstallStatus={handleInstallStatus}
          />
        </CardContent>

        {/* Send commands (process stdin) — hidden during an install */}
        {!installActive && canCommand && (
          <CardFooter>
            <form onSubmit={handleCommand} className="flex w-full gap-2">
              <Input
                placeholder={isAlive ? 'Commande à envoyer (ex : stop, say hello…)' : 'Serveur arrêté'}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                disabled={!isAlive || submitCommand.isPending}
              />
              <Button type="submit" disabled={!isAlive || submitCommand.isPending || !command.trim()}>
                <Send />
                Envoyer
              </Button>
            </form>
          </CardFooter>
        )}
      </Card>
      {submitCommand.isError && (
        <p className="text-sm text-destructive">{submitCommand.error.message}</p>
      )}
      <ConfirmDialog
        open={askKill}
        onOpenChange={setAskKill}
        onConfirm={() => {
          runAction('kill');
          setAskKill(false);
        }}
        title="Forcer l’arrêt du process ?"
        confirmLabel="Forcer l’arrêt"
        cancelLabel="Annuler"
        destructive
        pending={action.isPending}
      />
    </div>
  );
}

