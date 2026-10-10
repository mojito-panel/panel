import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useEffect } from 'react';
import { useState } from 'react';
import { useRef } from 'react';
import type { FormEvent } from 'react';
import { Play, Square, RotateCw, Skull, Send } from 'lucide-react';
import type { ConsoleClientMessage, ServerStatus } from '@mojito/contract';
import {
  getServerFn,
  getInstallStatusFn,
  serverActionFn,
  sendCommandFn,
} from '~/server/functions/servers';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { XtermConsole } from '~/components/console/xterm-console';
import { InstallPanel } from '~/components/console/install-panel';

export const Route = createFileRoute('/servers/$serverId/console')({
  component: ServerConsolePage,
});

function ServerConsolePage() {
  const { serverId } = Route.useParams();
  const queryClient = useQueryClient();
  const getServer = useServerFn(getServerFn);
  const doAction = useServerFn(serverActionFn);
  const sendCommand = useServerFn(sendCommandFn);

  const [command, setCommand] = useState('');
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

  // Live install/reinstall progress — replaces the console while it runs
  const getInstallStatus = useServerFn(getInstallStatusFn);
  const installQuery = useQuery({
    queryKey: ['install-status', serverId],
    queryFn: () => getInstallStatus({ data: { serverId, after: 0 } }),
    refetchInterval: (q) => (q.state.data?.status === 'installing' ? 1500 : false),
  });

  // Install finished → refresh the server (status stopped) and the list
  useEffect(() => {
    if (installQuery.data?.status === 'installed') {
      void queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      void queryClient.invalidateQueries({ queryKey: ['servers'] });
    }
  }, [installQuery.data?.status, queryClient, serverId]);

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

  // Install (or reinstall) in progress / failed → dedicated panel
  const installStatus = installQuery.data;
  if (installStatus && (installStatus.status === 'installing' || installStatus.status === 'failed')) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <InstallPanel serverId={serverId} status={installStatus} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-8">
      {query.isError && (
        <p className="mb-4 text-sm text-destructive">Erreur : {query.error.message}</p>
      )}

      {/* Power actions */}
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
      {action.isError && (
        <p className="mt-2 text-sm text-destructive">{action.error.message}</p>
      )}

      {/* Console */}
      <div className="mt-6">
        <XtermConsole
          serverId={serverId}
          isRunning={isRunning}
          onConnection={handleConsoleConnection}
          onStatus={(message) => handleConsoleStatus(message.status)}
        />

        {/* Send commands (process stdin) */}
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
        {submitCommand.isError && (
          <p className="mt-2 text-sm text-destructive">{submitCommand.error.message}</p>
        )}
      </div>
    </main>
  );
}
