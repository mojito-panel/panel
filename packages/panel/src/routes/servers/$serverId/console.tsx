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
} from '@mojito/contract';
import {
  getServerFn,
  getInstallStatusFn,
  retryInstallFn,
  serverActionFn,
  sendCommandFn,
} from '~/server/functions/servers';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { XtermConsole, type ConsoleMode } from '~/components/console/xterm-console';
import { InstallBanner, InstallPanel } from '~/components/console/install-panel';

export const Route = createFileRoute('/servers/$serverId/console')({
  component: ServerConsolePage,
});

function ServerConsolePage() {
  const { serverId } = Route.useParams();
  const queryClient = useQueryClient();
  const getServer = useServerFn(getServerFn);
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
    // Runtime status pushed by the agent → refresh the query (DB sync)
    void queryClient.invalidateQueries({ queryKey: ['server', serverId] });
  };

  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
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
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    }
  };

  const retry = useMutation({
    mutationFn: () => retryInstall({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      // The agent replays the new install over the WS (reset) — status follows
      await queryClient.invalidateQueries({ queryKey: ['install-status', serverId] });
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
  });

  const action = useMutation({
    mutationFn: (a: 'start' | 'stop' | 'restart' | 'kill') =>
      doAction({ data: { serverId, action: a } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
  });

  const submitCommand = useMutation({
    mutationFn: (cmd: string) => sendCommand({ data: { serverId, command: cmd } }),
  });

  const runAction = (a: 'start' | 'stop' | 'restart' | 'kill') => {
    if (wsSendRef.current) {
      wsSendRef.current({ type: 'power', action: a });
      return;
    }
    action.mutate(a);
  };

  const server = query.data;
  const isRunning = server?.status === 'running';

  // Install active: WS status first, DB status while the WS has not pushed yet
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

  // Degraded (polling) transport + install in progress → dedicated panel
  if (consoleMode === 'polling' && installQuery.data && installQuery.data.status !== 'installed') {
    return (
      <div>
        <InstallPanel serverId={serverId} status={installQuery.data} />
      </div>
    );
  }

  return (
    <div>
      {query.isError && (
        <p className="mb-4 text-sm text-destructive">Erreur : {query.error.message}</p>
      )}

      {/* Live install (steps + logs stream into the console below) */}
      {installActive && (
        <InstallBanner
          status={installStatus}
          onRetry={() => retry.mutate()}
          retryPending={retry.isPending}
          retryError={retry.isError ? retry.error.message : null}
        />
      )}

      {/* Power actions — meaningless during an install */}
      {!installActive && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => runAction('start')}
            disabled={action.isPending || isRunning}
          >
            <Play />
            Démarrer
          </Button>
          <Button
            variant="secondary"
            onClick={() => runAction('stop')}
            disabled={action.isPending || !isRunning}
          >
            <Square />
            Arrêter
          </Button>
          <Button
            variant="outline"
            onClick={() => runAction('restart')}
            disabled={action.isPending || !isRunning}
          >
            <RotateCw />
            Redémarrer
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm('Forcer l’arrêt du process ?')) runAction('kill');
            }}
            disabled={action.isPending || !isRunning}
          >
            <Skull />
            Kill
          </Button>
        </div>
      )}
      {action.isError && (
        <p className="mt-2 text-sm text-destructive">{action.error.message}</p>
      )}

      {/* Console — runtime logs AND install output (same WS, same terminal) */}
      <div className="mt-6">
        <XtermConsole
          serverId={serverId}
          isRunning={isRunning}
          installActive={installActive}
          onConnection={handleConsoleConnection}
          onStatus={(message) => handleConsoleStatus(message.status)}
          onMode={setConsoleMode}
          onInstallStatus={handleInstallStatus}
        />

        {/* Send commands (process stdin) — hidden during an install */}
        {!installActive && (
          <form onSubmit={handleCommand} className="mt-3 flex gap-2">
            <Input
              placeholder={isRunning ? 'Commande à envoyer (ex : stop, say hello…)' : 'Serveur arrêté'}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={!isRunning || submitCommand.isPending}
            />
            <Button type="submit" disabled={!isRunning || submitCommand.isPending || !command.trim()}>
              <Send />
              Envoyer
            </Button>
          </form>
        )}
        {submitCommand.isError && (
          <p className="mt-2 text-sm text-destructive">{submitCommand.error.message}</p>
        )}
      </div>
    </div>
  );
}

