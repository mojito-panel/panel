import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Plus, Trash2 } from 'lucide-react';
import { listServersFn, deleteServerFn } from '~/server/functions/servers';
import { StatusBadge } from '~/components/status-badge';
import { Button } from '~/components/ui/button';
import { useAuth } from '~/contexts/use-auth';

export const Route = createFileRoute('/_app/servers/')({
  component: ServersPage,
});

function ServersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const listServers = useServerFn(listServersFn);
  const deleteServer = useServerFn(deleteServerFn);

  const query = useQuery({
    queryKey: ['servers'],
    queryFn: () => listServers(),
  });

  const remove = useMutation({
    mutationFn: (serverId: string) => deleteServer({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const servers = query.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mes serveurs</h1>
          <p className="text-muted-foreground">
            {user?.role === 'admin' ? 'Vue administrateur — tous les serveurs' : 'Tes serveurs de jeu'}
          </p>
        </div>
        <div className="flex gap-2">
          {user?.role === 'admin' && (
            <>
              <Button variant="outline" asChild>
                <Link to="/admin/nodes">Nodes</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/admin/recipes">Recettes</Link>
              </Button>
            </>
          )}
          <Button asChild>
            <Link to="/servers/new">
              <Plus />
              Nouveau serveur
            </Link>
          </Button>
        </div>
      </div>

      {query.isLoading && <p className="mt-8 text-muted-foreground">Chargement…</p>}
      {query.isError && (
        <p className="mt-8 text-sm text-destructive">Erreur : {query.error.message}</p>
      )}

      {query.data && servers.length === 0 && (
        <div className="mt-8 rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">Aucun serveur pour l'instant.</p>
          <Button className="mt-4" asChild>
            <Link to="/servers/new">
              <Plus />
              Créer mon premier serveur
            </Link>
          </Button>
        </div>
      )}

      <div className="mt-8 space-y-3">
        {servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            <div className="min-w-0">
              <Link
                to="/servers/$serverId/console"
                params={{ serverId: server.id }}
                className="font-semibold hover:underline"
              >
                {server.name}
              </Link>
              <p className="truncate text-sm text-muted-foreground">
                {server.recipeName} · {server.nodeName}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={server.status} />
              <Button
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Supprimer « ${server.name} » ? Le dossier sera effacé.`)) {
                    remove.mutate(server.id);
                  }
                }}
              >
                <Trash2 />
                Supprimer
              </Button>
            </div>
          </div>
        ))}
      </div>

      {remove.isError && (
        <p className="mt-4 text-sm text-destructive">{remove.error.message}</p>
      )}

      <p className="mt-8">
        <Button variant="ghost" asChild>
          <Link to="/">← Retour à l'accueil</Link>
        </Button>
      </p>
    </div>
  );
}
