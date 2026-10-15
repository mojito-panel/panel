import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { DataTable } from '~/components/data-table/data-table';
import { useAuth } from '~/contexts/use-auth';
import { canFromPermissions } from '~/lib/permissions';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { adminServersList, type AdminServerRow } from '~/lists/servers';
import { listNodesFn } from '~/server/functions/admin';
import { deleteAdminServerFn, listAdminServersFn } from '~/server/functions/admin-servers';

/**
 * /admin/servers — every server of the installation, every owner (Pelican
 * admin ListServers). Filtering, sorting and pagination run in the database;
 * the list definition (`~/lists/servers`) holds the columns AND the query it
 * accepts, the state lives in the URL search params.
 */
export const Route = createFileRoute('/admin/servers/')({
  // Same schema as the server function: the route validates the URL, the
  // function validates the payload — one definition, no drift.
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    adminServersList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(adminServersList.defaultSearch)] },
  component: AdminServersPage,
});

function AdminServersPage() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  const listServers = useServerFn(listAdminServersFn);
  const deleteServer = useServerFn(deleteAdminServerFn);
  const listNodes = useServerFn(listNodesFn);

  const canDelete = canFromPermissions(permissions, { 'panel.servers': ['delete'] });

  // Options of the `node` filter (the node list is data, not a constant).
  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => listNodes(),
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ['admin-servers', search],
    queryFn: () => listServers({ data: search }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (server: AdminServerRow) => deleteServer({ data: { serverId: server.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      toast.success('Serveur supprimé');
    },
    onError: (error) => toast.error(error.message),
  });

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const onDelete = (server: AdminServerRow) => {
    if (confirm(`Supprimer « ${server.name} » ? Le dossier sera effacé sur le node.`)) {
      remove.mutate(server);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Serveurs</h1>
        <p className="text-muted-foreground">
          Tous les serveurs de l’installation, tous propriétaires confondus.
        </p>
      </div>

      <DataTable
        list={adminServersList}
        rows={query.data?.rows ?? []}
        rowCount={query.data?.rowCount ?? 0}
        search={search}
        onSearchChange={onSearchChange}
        isPending={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        filterOptions={{
          node: (nodesQuery.data ?? []).map((node) => ({ value: node.id, label: node.name })),
        }}
        rowContext={{ canDelete, deleting: remove.isPending, onDelete }}
      />
    </div>
  );
}
