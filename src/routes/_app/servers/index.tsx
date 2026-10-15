import { createFileRoute, Link, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { DataTable } from '~/components/data-table/data-table';
import { Button } from '~/components/ui/button';
import { useAuth } from '~/contexts/use-auth';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { userServersList, type UserServerRow } from '~/lists/user-servers';
import { adminNodesList } from '~/lists/nodes';
import { adminRecipesList } from '~/lists/recipes';
import { deleteServerFn, listServersFn } from '~/server/functions/servers';

/**
 * /servers — the signed-in user's own servers (Pelican ListServers scoped to
 * the viewer). Filtering, searching, sorting and pagination run in the
 * database; the list definition (`~/lists/user-servers`) holds the columns AND
 * the query it accepts, the state lives in the URL search params.
 */
export const Route = createFileRoute('/_app/servers/')({
  // Same schema as the server function: the route validates the URL, the
  // function validates the payload — one definition, no drift.
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    userServersList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(userServersList.defaultSearch)] },
  component: ServersPage,
});

function ServersPage() {
  const { user } = useAuth();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  const listServers = useServerFn(listServersFn);
  const deleteServer = useServerFn(deleteServerFn);

  const query = useQuery({
    queryKey: ['servers', search],
    queryFn: () => listServers({ data: search }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (server: UserServerRow) =>
      deleteServer({ data: { serverId: server.id, after: 0 } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      toast.success('Serveur supprimé');
    },
    onError: (error) => toast.error(error.message),
  });

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const onDelete = (server: UserServerRow) => {
    if (confirm(`Supprimer « ${server.name} » ? Le dossier sera effacé.`)) {
      remove.mutate(server);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mes serveurs</h1>
          <p className="text-muted-foreground">
            {user?.role === 'admin'
              ? 'Vue administrateur — tous les serveurs'
              : 'Tes serveurs de jeu'}
          </p>
        </div>
        <div className="flex gap-2">
          {user?.role === 'admin' && (
            <>
              <Button
                variant="outline"
                render={<Link to="/admin/nodes" search={adminNodesList.defaultSearch} />}
              >
                Nodes
              </Button>
              <Button
                variant="outline"
                render={<Link to="/admin/recipes" search={adminRecipesList.defaultSearch} />}
              >
                Recettes
              </Button>
            </>
          )}
          <Button render={<Link to="/servers/new" />}>
            <Plus />
            Nouveau serveur
          </Button>
        </div>
      </div>

      {query.data && query.data.rowCount === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-muted-foreground">Aucun serveur pour l'instant.</p>
          <Button className="mt-4" render={<Link to="/servers/new" />}>
            <Plus />
            Créer mon premier serveur
          </Button>
        </div>
      ) : (
        <DataTable
          list={userServersList}
          rows={query.data?.rows ?? []}
          rowCount={query.data?.rowCount ?? 0}
          search={search}
          onSearchChange={onSearchChange}
          isPending={query.isPending}
          isFetching={query.isFetching}
          error={query.error}
          rowContext={{ deleting: remove.isPending, onDelete }}
        />
      )}

      <p>
        <Button variant="ghost" render={<Link to="/" />}>
          ← Retour à l'accueil
        </Button>
      </p>
    </div>
  );
}
