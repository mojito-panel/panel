import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '~/components/confirm-dialog';
import { DataTable } from '~/components/data-table/data-table';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { useAuth } from '~/contexts/use-auth';
import { hasAdminAreaAccess, hasPermissions } from '~/lib/permissions';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { adminNodesList } from '~/lists/nodes';
import { adminRecipesList } from '~/lists/recipes';
import { userServersList, type UserServerRow } from '~/lists/user-servers';
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
  const permissions = user?.permissions ?? [];
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  // Permission-gated shortcuts (the admin sidebar items) — the session's
  // effective permissions decide, not the built-in role name.
  const canViewNodes = hasPermissions(permissions, { 'panel.nodes': ['read'] });
  const canViewRecipes = hasPermissions(permissions, { 'panel.recipes': ['read'] });

  const listServers = useServerFn(listServersFn);
  const deleteServer = useServerFn(deleteServerFn);
  const [toDelete, setToDelete] = useState<UserServerRow | null>(null);

  // Row whose deletion failed against an unreachable agent — the force
  // dialog offers the panel-only retry.
  const [forceTarget, setForceTarget] = useState<UserServerRow | null>(null);

  const query = useQuery({
    queryKey: ['servers', search],
    queryFn: () => listServers({ data: search }),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (input: { server: UserServerRow; force?: boolean }) =>
      deleteServer({ data: { serverId: input.server.id, force: input.force } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      toast.success('Serveur supprimé');
    },
    onError: (error, input) => {
      toast.error(error.message);
      if (input && !input.force) setForceTarget(input.server);
    },
  });

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  return (
    <div className="space-y-6">
      {/* ─── Server list — filtering/sorting/pagination run in the database ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Mes serveurs</CardTitle>
          <CardDescription>
            {hasAdminAreaAccess(permissions)
              ? 'Vue administrateur — tous les serveurs'
              : 'Tes serveurs de jeu'}
          </CardDescription>
          <CardAction>
            <div className="flex gap-2">
              {canViewNodes && (
                <Button
                  variant="outline"
                  render={<Link to="/admin/nodes" search={adminNodesList.defaultSearch} />}
                >
                  Nodes
                </Button>
              )}
              {canViewRecipes && (
                <Button
                  variant="outline"
                  render={<Link to="/admin/recipes" search={adminRecipesList.defaultSearch} />}
                >
                  Recettes
                </Button>
              )}
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <DataTable
            list={userServersList}
            rows={query.data?.rows ?? []}
            rowCount={query.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            rowContext={{ deleting: remove.isPending, onDelete: setToDelete }}
          />
        </CardContent>
      </Card>

      <p>
        <Button variant="ghost" render={<Link to="/" />}>
          ← Retour à l'accueil
        </Button>
      </p>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await remove.mutateAsync({ server: toDelete });
            setToDelete(null);
          } catch {
            // Toasted by the mutation — an unreachable agent opens the force
            // dialog (the mutation's onError), so this one closes either way.
            setToDelete(null);
          }
        }}
        title={toDelete ? `Supprimer « ${toDelete.name} » ?` : ''}
        description="Le dossier sera effacé."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
      <ConfirmDialog
        open={forceTarget !== null}
        onOpenChange={(open) => !open && setForceTarget(null)}
        onConfirm={async () => {
          if (!forceTarget) return;
          try {
            await remove.mutateAsync({ server: forceTarget, force: true });
            setForceTarget(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
        }}
        title={forceTarget ? `Supprimer « ${forceTarget.name} » sans l’agent ?` : ''}
        description="L’agent est injoignable : le serveur sera supprimé du panel, mais son dossier et son conteneur resteront sur le node — ils seront nettoyés automatiquement dès que le node répondra à nouveau."
        confirmLabel="Supprimer quand même"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}
