import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  getServerFn,
  serverActionFn,
  sendCommandFn,
} from '~/server/functions/servers';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { XtermConsole } from '~/components/console/xterm-console';

export const Route = createFileRoute('/_app/servers/$serverId')({
  component: ServerDetailPage,
});

function ServerDetailPage() {
  const { serverId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getServer = useServerFn(getServerFn);
  const doAction = useServerFn(serverActionFn);
  const sendCommand = useServerFn(sendCommandFn);

  const [command, setCommand] = useState('');

  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
    refetchInterval: 5000,
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

  const server = query.data;
  const isRunning = server?.status === 'running';

  const handleCommand = (e: FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    submitCommand.mutate(command.trim());
    setCommand('');
  };

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{server?.name ?? '…'}</h1>
          {server && (
            <p className="text-muted-foreground">
              {server.plugin.name} · {server.node.name} ({server.node.fqdn}) · port{' '}
              {server.allocation?.port ?? '—'} · {server.allocation?.memoryMb ?? '—'} Mo
            </p>
          )}
        </div>
        <span
          className={
            server?.status === 'running'
              ? 'rounded-full bg-green-100 px-3 py-1 text-sm text-green-700'
              : server?.status === 'crashed'
                ? 'rounded-full bg-red-100 px-3 py-1 text-sm text-red-700'
                : 'rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground'
          }
        >
          {server?.status ?? '…'}
        </span>
      </div>

      {query.isError && (
        <p className="mt-4 text-sm text-destructive">Erreur : {query.error.message}</p>
      )}

      {/* Actions power */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          onClick={() => action.mutate('start')}
          disabled={action.isPending || isRunning}
        >
          Démarrer
        </Button>
        <Button
          variant="secondary"
          onClick={() => action.mutate('stop')}
          disabled={action.isPending || !isRunning}
        >
          Arrêter
        </Button>
        <Button
          variant="outline"
          onClick={() => action.mutate('restart')}
          disabled={action.isPending || !isRunning}
        >
          Redémarrer
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            if (confirm('Forcer l’arrêt du process ?')) action.mutate('kill');
          }}
          disabled={action.isPending || !isRunning}
        >
          Kill
        </Button>
      </div>
      {action.isError && (
        <p className="mt-2 text-sm text-destructive">{action.error.message}</p>
      )}

      {/* Console */}
      <div className="mt-8">
        <XtermConsole serverId={serverId} isRunning={isRunning} />

        {/* Envoi de commandes (stdin du process) */}
        <form onSubmit={handleCommand} className="mt-3 flex gap-2">
          <Input
            placeholder={isRunning ? 'Commande à envoyer (ex : stop, say hello…)' : 'Serveur arrêté'}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={!isRunning || submitCommand.isPending}
          />
          <Button type="submit" disabled={!isRunning || submitCommand.isPending || !command.trim()}>
            Envoyer
          </Button>
        </form>
        {submitCommand.isError && (
          <p className="mt-2 text-sm text-destructive">{submitCommand.error.message}</p>
        )}
      </div>

      <p className="mt-8">
        <Button
          variant="ghost"
          onClick={() => navigate({ to: '/servers' })}
        >
          ← Mes serveurs
        </Button>
      </p>
    </main>
  );
}
