import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm, useStore } from '@tanstack/react-form';
import { toast } from 'sonner';
import { Search, Trash2 } from 'lucide-react';
import {
  listAdminServersFn,
  deleteAdminServerFn,
} from '~/server/functions/admin-servers';
import { listNodesFn } from '~/server/functions/admin';
import { canFromPermissions } from '~/lib/permissions';
import { useAuth } from '~/contexts/use-auth';
import { StatusBadge, statusLabel } from '~/components/status-badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Card, CardContent } from '~/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

/**
 * /admin/servers — all servers of the installation, every owner (Pelican
 * admin ListServers): free-text search (name or owner email), node and
 * status filters, row link to the admin detail page.
 */
export const Route = createFileRoute('/admin/servers/')({
  component: AdminServersPage,
});

/** DB status values of a server (suspension is a separate flag). */
const STATUSES = [
  'installing',
  'install_failed',
  'stopped',
  'starting',
  'running',
  'stopping',
  'crashed',
] as const;

/** Sentinel of the "no filter" select options. */
const ALL = 'all';

function AdminServersPage() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const queryClient = useQueryClient();

  const listServers = useServerFn(listAdminServersFn);
  const deleteServer = useServerFn(deleteAdminServerFn);
  const listNodes = useServerFn(listNodesFn);

  const canDelete = canFromPermissions(permissions, { 'panel.servers': ['delete'] });

  // Filters — TanStack Form, the values feed the query key reactively
  const filterForm = useForm({
    defaultValues: { search: '', nodeId: '', status: '' },
  });
  const search = useStore(filterForm.store, (s) => s.values.search);
  const nodeId = useStore(filterForm.store, (s) => s.values.nodeId);
  const status = useStore(filterForm.store, (s) => s.values.status);

  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => listNodes(),
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: ['admin-servers', search, nodeId, status],
    queryFn: () =>
      listServers({
        data: {
          search: search || undefined,
          nodeId: nodeId && nodeId !== ALL ? nodeId : undefined,
          status: status && status !== ALL ? status : undefined,
        },
      }),
  });

  const remove = useMutation({
    mutationFn: (serverId: string) => deleteServer({ data: { serverId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      toast.success('Serveur supprimé');
    },
    onError: (error) => toast.error(error.message),
  });

  const servers = query.data?.servers ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Serveurs</h1>
        <p className="text-muted-foreground">
          Tous les serveurs de l’installation, tous propriétaires confondus.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          {/* ─── Filters (search + node + status) ─── */}
          <div className="flex flex-wrap items-start gap-2">
            <filterForm.Field name="search">
              {(field) => (
                <div className="relative w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Rechercher un nom ou un e-mail…"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </div>
              )}
            </filterForm.Field>

            <filterForm.Field name="nodeId">
              {(field) => (
                <Select
                  value={field.state.value}
                  onValueChange={(value) => value !== null && field.handleChange(value)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Tous les nodes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tous les nodes</SelectItem>
                    {(nodesQuery.data ?? []).map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        {node.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </filterForm.Field>

            <filterForm.Field name="status">
              {(field) => (
                <Select
                  value={field.state.value}
                  onValueChange={(value) => value !== null && field.handleChange(value)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Tous les statuts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tous les statuts</SelectItem>
                    {STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {statusLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </filterForm.Field>
          </div>

          {query.isPending && (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          )}
          {query.isError && (
            <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
          )}

          {servers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Serveur</th>
                    <th className="py-2 pr-4 font-medium">Propriétaire</th>
                    <th className="py-2 pr-4 font-medium">Node</th>
                    <th className="py-2 pr-4 font-medium">Statut</th>
                    <th className="py-2 pr-4 font-medium">Créé le</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {servers.map((server) => (
                    <tr key={server.id} className={server.suspended ? 'opacity-60' : undefined}>
                      <td className="py-2 pr-4">
                        <Link
                          to="/admin/servers/$serverId"
                          params={{ serverId: server.id }}
                          className="font-medium hover:underline"
                        >
                          {server.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{server.recipeName}</p>
                      </td>
                      <td className="py-2 pr-4">
                        <p className="font-medium">{server.ownerName ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">{server.ownerEmail}</p>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{server.nodeName}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={server.status} />
                          {server.suspended && (
                            <span className="rounded-full border border-destructive/50 px-2 py-0.5 text-xs text-destructive">
                              Suspendu
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(server.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="py-2">
                        {canDelete && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={remove.isPending}
                              onClick={() => {
                                if (
                                  confirm(
                                    `Supprimer « ${server.name} » ? Le dossier sera effacé sur le node.`,
                                  )
                                ) {
                                  remove.mutate(server.id);
                                }
                              }}
                            >
                              <Trash2 />
                              Supprimer
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !query.isPending && (
              <p className="text-sm text-muted-foreground">
                Aucun serveur ne correspond à ces filtres.
              </p>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
