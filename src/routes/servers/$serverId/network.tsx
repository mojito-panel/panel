import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { Star, Trash2 } from 'lucide-react';
import {
  getServerFn,
  getServerNetworkFn,
  addServerAllocationFn,
  removeServerAllocationFn,
  setPrimaryServerAllocationFn,
} from '~/server/functions/servers';
import { serverAllocationActionSchema } from '~/validators/server';
import { serverCan } from '~/lib/permissions';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

export const Route = createFileRoute('/servers/$serverId/network')({
  component: ServerNetworkPage,
});

interface NetworkAllocation {
  id: string;
  ip: string;
  port: number;
  alias: string | null;
  primary: boolean;
}

/** /servers/$serverId/network — Pelican Network page: allocations IP:port. */
function ServerNetworkPage() {
  const { serverId } = Route.useParams();
  const queryClient = useQueryClient();

  const getNetwork = useServerFn(getServerNetworkFn);
  const getServer = useServerFn(getServerFn);
  const addAllocation = useServerFn(addServerAllocationFn);
  const removeAllocation = useServerFn(removeServerAllocationFn);
  const setPrimary = useServerFn(setPrimaryServerAllocationFn);

  const query = useQuery({
    queryKey: ['server-network', serverId],
    queryFn: () => getNetwork({ data: { serverId, after: 0 } }),
  });

  // Shared server query (cached) — the viewer's per-server grants gate the
  // mutation buttons (sub-users without server.network.update see read-only)
  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
  });
  const canEdit = serverCan(serverQuery.data?.viewer?.permissions ?? [], {
    'server.network': ['update'],
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['server-network', serverId] });
    await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
  };

  const add = useMutation({
    mutationFn: (allocationId: string) =>
      addAllocation({ data: { serverId, allocationId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Allocation ajoutée');
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (allocationId: string) =>
      removeAllocation({ data: { serverId, allocationId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Allocation retirée — elle retourne dans le pool du node');
    },
    onError: (err) => toast.error(err.message),
  });

  const primary = useMutation({
    mutationFn: (allocationId: string) =>
      setPrimary({ data: { serverId, allocationId } }),
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

  const allocations = query.data?.allocations ?? [];
  const free = query.data?.free ?? [];

  return (
    <div className="space-y-6">
      {query.isError && (
        <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Allocations</CardTitle>
          <CardDescription>
            Ports réseau affectés à ce serveur. L’allocation principale fournit
            SERVER_PORT et SERVER_IP — un changement s’applique au prochain
            démarrage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : allocations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune allocation — réclames-en une dans le pool du node ci-dessous.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Adresse</th>
                  <th className="py-2 pr-4 font-medium">Alias</th>
                  <th className="py-2 pr-4 font-medium">Principale</th>
                  <th className="py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allocations.map((allocation) => (
                  <AllocationRow
                    key={allocation.id}
                    allocation={allocation}
                    canEdit={canEdit}
                    onSetPrimary={() => primary.mutate(allocation.id)}
                    onRemove={() => {
                      if (
                        confirm(
                          `Retirer l’allocation ${allocation.ip}:${allocation.port} ? Elle retournera dans le pool du node.`,
                        )
                      ) {
                        remove.mutate(allocation.id);
                      }
                    }}
                    busy={
                      (primary.isPending && primary.variables === allocation.id) ||
                      (remove.isPending && remove.variables === allocation.id)
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ajouter une allocation</CardTitle>
          <CardDescription>
            Réclame un port libre dans le pool du node (Pelican : « Add
            allocation »).
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
                    <p className="text-sm text-destructive">
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
          {free.length === 0 && !query.isPending && (
            <p className="mt-2 text-sm text-muted-foreground">
              Aucune allocation libre sur ce node — un administrateur doit en
              créer dans la page du node.
            </p>
          )}
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Tu n’as pas la permission de modifier le réseau de ce serveur.
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/** One allocation row of the Network page table. */
function AllocationRow({
  allocation,
  canEdit,
  onSetPrimary,
  onRemove,
  busy,
}: {
  allocation: NetworkAllocation;
  canEdit: boolean;
  onSetPrimary: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <tr>
      <td className="py-2 pr-4 font-mono">
        {allocation.ip}:{allocation.port}
      </td>
      <td className="py-2 pr-4">{allocation.alias ?? '—'}</td>
      <td className="py-2 pr-4">
        {allocation.primary ? (
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            Principale
          </span>
        ) : canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onSetPrimary}
          >
            <Star />
            Définir principale
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-2 text-right">
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={allocation.primary || busy}
            title={
              allocation.primary
                ? 'Définis une autre allocation principale avant de retirer celle-ci'
                : undefined
            }
            onClick={onRemove}
          >
            <Trash2 />
            Retirer
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
