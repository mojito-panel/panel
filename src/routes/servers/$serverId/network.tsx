import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '~/components/confirm-dialog';
import { DataTable } from '~/components/data-table/data-table';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { hasServerPermissions } from '~/lib/permissions';
import { serverAllocationsList, type ServerAllocationRow } from '~/lists/allocations';
import { mergeQuery, type ListQuery } from '~/lists/define';
import {
  getServerFn,
  listServerAllocationsFn,
  listServerFreeAllocationsFn,
  addServerAllocationFn,
  removeServerAllocationFn,
  setPrimaryServerAllocationFn,
} from '~/server/functions/servers';
import { serverAllocationActionSchema } from '~/validators/server';

export const Route = createFileRoute('/servers/$serverId/network')({
  // Same schema as the server function: the route validates the URL, the
  // function validates the payload — one definition, no drift.
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    serverAllocationsList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(serverAllocationsList.defaultSearch)] },
  component: ServerNetworkPage,
});

/** /servers/$serverId/network — Pelican Network page: allocations IP:port. */
function ServerNetworkPage() {
  const { serverId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [toRevoke, setToRevoke] = useState<ServerAllocationRow | null>(null);

  const listAllocations = useServerFn(listServerAllocationsFn);
  const listFree = useServerFn(listServerFreeAllocationsFn);
  const getServer = useServerFn(getServerFn);
  const addAllocation = useServerFn(addServerAllocationFn);
  const removeAllocation = useServerFn(removeServerAllocationFn);
  const setPrimary = useServerFn(setPrimaryServerAllocationFn);

  const query = useQuery({
    queryKey: ['server-allocations', serverId, search],
    queryFn: () => listAllocations({ data: { serverId, ...search } }),
    placeholderData: keepPreviousData,
  });
  const freeQuery = useQuery({
    queryKey: ['server-allocations-free', serverId],
    queryFn: () => listFree({ data: { serverId } }),
  });

  // Shared server query (cached) — the viewer's per-server grants gate the
  // mutation buttons (sub-users without server.network.update see read-only)
  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });
  const canEdit = hasServerPermissions(serverQuery.data?.viewer?.permissions ?? [], {
    'server.network': ['update'],
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['server-allocations', serverId] });
    await queryClient.invalidateQueries({ queryKey: ['server-allocations-free', serverId] });
    await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
  };

  const add = useMutation({
    mutationFn: (allocationId: string) => addAllocation({ data: { serverId, allocationId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Allocation ajoutée');
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (allocationId: string) => removeAllocation({ data: { serverId, allocationId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Allocation retirée — elle retourne dans le pool du node');
    },
    onError: (err) => toast.error(err.message),
  });

  const primary = useMutation({
    mutationFn: (allocationId: string) => setPrimary({ data: { serverId, allocationId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Allocation principale mise à jour — appliquée au prochain démarrage');
    },
    onError: (err) => toast.error(err.message),
  });

  // The claim form holds only the picked free allocation — serverId comes
  // from the route, the payload is validated by the server function
  const form = useForm({
    validators: { onChange: serverAllocationActionSchema.pick({ allocationId: true }) },
    defaultValues: { allocationId: '' },
    onSubmit: ({ value }) => add.mutate(value.allocationId),
  });

  const free = freeQuery.data ?? [];

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page reset is part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Allocations</CardTitle>
          <CardDescription>
            Ports réseau affectés à ce serveur. L’allocation principale fournit SERVER_PORT et
            SERVER_IP — un changement s’applique au prochain démarrage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            list={serverAllocationsList}
            rows={query.data?.rows ?? []}
            rowCount={query.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            emptyMessage="Aucune allocation — réclames-en une dans le pool du node ci-dessous."
            rowContext={{
              canEdit,
              busy: primary.isPending || remove.isPending,
              onSetPrimary: (allocation) => primary.mutate(allocation.id),
              onRevoke: setToRevoke,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ajouter une allocation</CardTitle>
          <CardDescription>
            Réclame un port libre dans le pool du node (Pelican : « Add allocation »).
          </CardDescription>
        </CardHeader>
        {canEdit ? (
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="flex max-w-md items-start gap-2"
            >
              <form.Field name="allocationId">
                {(field) => (
                  <div className="flex-1 space-y-2">
                    <Select
                      value={field.state.value}
                      onValueChange={(v) => v !== null && field.handleChange(v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="— Port disponible —" />
                      </SelectTrigger>
                      <SelectContent>
                        {free.map((allocation) => (
                          <SelectItem key={allocation.id} value={allocation.id}>
                            {allocation.ip}:{allocation.port}
                            {allocation.alias ? ` (${allocation.alias})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {field.state.meta.errors[0]?.message}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
              <Button type="submit" disabled={add.isPending || free.length === 0}>
                Ajouter
              </Button>
            </form>
            {free.length === 0 && !freeQuery.isPending && (
              <p className="text-muted-foreground mt-2 text-sm">
                Aucune allocation libre sur ce node — un administrateur doit en créer dans la page
                du node.
              </p>
            )}
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Tu n’as pas la permission de modifier le réseau de ce serveur.
            </p>
          </CardContent>
        )}
      </Card>
      <ConfirmDialog
        open={toRevoke !== null}
        onOpenChange={(open) => !open && setToRevoke(null)}
        onConfirm={async () => {
          if (!toRevoke) return;
          try {
            await remove.mutateAsync(toRevoke.id);
            setToRevoke(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
        }}
        title={toRevoke ? `Retirer l’allocation ${toRevoke.ip}:${toRevoke.port} ?` : ''}
        description="Elle retournera dans le pool du node."
        confirmLabel="Retirer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}
