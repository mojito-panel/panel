import { useState } from 'react';
import { createFileRoute, Link, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { DataTable } from '~/components/data-table/data-table';
import { useAuth } from '~/contexts/use-auth';
import { hasPermissions } from '~/lib/permissions';
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

  const canDelete = hasPermissions(permissions, { 'panel.servers': ['delete'] });
  const canCreate = hasPermissions(permissions, { 'panel.servers': ['create'] });

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
    mutationFn: (input: { server: AdminServerRow; force?: boolean }) =>
      deleteServer({ data: { serverId: input.server.id, force: input.force } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      toast.success('Serveur supprimé');
    },
    onError: (error, input) => {
      toast.error(error.message);
      // Agent unreachable → offer the force retry for THIS row.
      if (input && !input.force) setForceTarget(input.server);
    },
  });

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  // Pending deletion target — the ConfirmDialog renders on top of it.
  const [serverToDelete, setServerToDelete] = useState<AdminServerRow | null>(null);

  // Row whose deletion failed against an unreachable agent — the force
  // dialog offers the panel-only retry.
  const [forceTarget, setForceTarget] = useState<AdminServerRow | null>(null);


  return (
    <div className="space-y-6">
      {/* ─── Server list — filtering/sorting/pagination run in the database ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Serveurs</CardTitle>
          <CardDescription>
            Tous les serveurs de l’installation, tous propriétaires confondus.
          </CardDescription>
          {/* Creation form lives at /admin/servers/new — same permission
              (panel.servers.create), guarded again in its beforeLoad. */}
          {canCreate && (
            <CardAction>
              <Button render={<Link to="/admin/servers/new" />}>
                <Plus />
                Nouveau serveur
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
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
            rowContext={{ canDelete, deleting: remove.isPending, onDelete: setServerToDelete }}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={serverToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setServerToDelete(null);
        }}
        onConfirm={() => {
          if (serverToDelete) remove.mutate({ server: serverToDelete });
          setServerToDelete(null);
        }}
        title={`Supprimer « ${serverToDelete?.name} » ?`}
        description="Le dossier sera effacé sur le node."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />

      <ConfirmDialog
        open={forceTarget !== null}
        onOpenChange={(open) => {
          if (!open) setForceTarget(null);
        }}
        onConfirm={() => {
          if (forceTarget) remove.mutate({ server: forceTarget, force: true });
          setForceTarget(null);
        }}
        title={`Supprimer « ${forceTarget?.name} » sans l’agent ?`}
        description="L’agent est injoignable : le serveur sera supprimé du panel, mais son dossier et son conteneur resteront sur le node — ils seront nettoyés automatiquement dès que le node répondra à nouveau."
        confirmLabel="Supprimer quand même"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}
