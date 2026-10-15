import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import {
  getAdminServerFn,
  updateAdminServerFn,
  setAdminServerSuspendedFn,
  reinstallAdminServerFn,
  deleteAdminServerFn,
  listAdminServerAllocationsFn,
  listAdminServerFreeAllocationsFn,
  addAdminServerAllocationFn,
  removeAdminServerAllocationFn,
  setPrimaryAdminServerAllocationFn,
} from '~/server/functions/admin-servers';
import { listUsersFn } from '~/server/functions/users';
import {
  updateAdminServerFormSchema,
  adminServerAllocationActionSchema,
  type UpdateAdminServerFormDto,
} from '~/validators/admin-server';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { DataPicker } from '~/components/data-table/data-picker';
import { DataTable } from '~/components/data-table/data-table';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { serverAllocationsList, type ServerAllocationRow } from '~/lists/allocations';
import { adminServersList } from '~/lists/servers';
import { adminUsersList } from '~/lists/users';
import { canFromPermissions } from '~/lib/permissions';
import { useAuth } from '~/contexts/use-auth';
import { StatusBadge, statusLabel } from '~/components/status-badge';
import { CardSection, TabsCard, type TabsCardTab } from '~/components/tabs-card';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Separator } from '~/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

/**
 * /admin/servers/$serverId — Pelican admin EditServer equivalent: a single
 * record form spread over tabs (Informations / Ressources — Pelican
 * "information" + "environment configuration"), the Allocations manager
 * (Pelican AllocationsRelationManager) and management Actions (suspend,
 * reinstall, delete). Read-only for profiles without panel.servers.update.
 */
export const Route = createFileRoute('/admin/servers/$serverId')({
  component: AdminServerPage,
});

/** Admin server detail payload (getAdminServerFn). */
interface AdminServerDto {
  id: string;
  name: string;
  status: string;
  runtimeState: string | null;
  suspended: boolean;
  memoryMb: number;
  cpuCores: number;
  backupLimit: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  node: { id: string; name: string; fqdn: string; sftpPort: number };
  recipe: { id: string; name: string; slug: string };
  owner: { id: string; name: string | null; email: string } | null;
  allocations: Array<{ id: string; ip: string; port: number; alias: string | null; primary: boolean }>;
  subuserCount: number;
  backupCount: number;
}

/** Owner selection stored by the picker (mirrors the server's owner DTO). */
interface OwnerSelection {
  id: string;
  name: string | null;
  email: string;
}

/** Read-only info entry (Pelican TextEntry equivalent). */
function InfoEntry({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-medium ${muted ? 'text-muted-foreground' : ''}`}>{value}</p>
    </div>
  );
}

function AdminServerPage() {
  const { serverId } = Route.useParams();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const getServer = useServerFn(getAdminServerFn);

  const query = useQuery({
    queryKey: ['admin-server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });

  if (query.isPending) {
    return <p className="text-muted-foreground">Chargement du serveur…</p>;
  }
  if (query.isError) {
    return <p className="text-destructive">{query.error.message}</p>;
  }

  const server = query.data;
  const canUpdate = canFromPermissions(permissions, { 'panel.servers': ['update'] });
  const canDelete = canFromPermissions(permissions, { 'panel.servers': ['delete'] });

  return (
    <div>
      {/* ─── Record header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{server.name}</h1>
            <StatusBadge status={server.status} />
            {server.suspended && (
              <span className="rounded-full border border-destructive/50 px-2 py-0.5 text-xs text-destructive">
                Suspendu
              </span>
            )}
          </div>
          <p className="mt-1 text-muted-foreground">
            {server.recipe.name} · {server.node.name} ·{' '}
            {server.owner ? `${server.owner.name ?? ''} (${server.owner.email})` : '—'}
          </p>
        </div>
        {/* Pelican EditServer "console" header action — jump to the user area */}
        <Button variant="outline" render={<Link to="/servers/$serverId/console" params={{ serverId }} />}>
          <ExternalLink />
          Ouvrir la console
        </Button>
      </div>

      <ServerRecordTabs server={server} canUpdate={canUpdate} canDelete={canDelete} />
    </div>
  );
}

/**
 * The tabbed record (Pelican detailTabs). Owns the ONE record form —
 * Informations and Ressources are parts of the same form, each with a
 * submit button (TabsCard keeps inactive panels mounted, so values typed
 * in one tab survive a switch to the other).
 */
function ServerRecordTabs({
  server,
  canUpdate,
  canDelete,
}: {
  server: AdminServerDto;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canListUsers = canFromPermissions(permissions, { user: ['list'] });

  // Owner picker: one page of the users list (the user:list permission gates it)
  const listUsers = useServerFn(listUsersFn);
  const [ownerSelection, setOwnerSelection] = useState<OwnerSelection | null>(null);
  const ownerValue =
    ownerSelection ??
    (server.owner
      ? { id: server.owner.id, name: server.owner.name, email: server.owner.email }
      : null);

  const queryClient = useQueryClient();
  const updateServer = useServerFn(updateAdminServerFn);

  const update = useMutation({
    mutationFn: async (values: UpdateAdminServerFormDto) => {
      const result = await updateServer({ data: { ...values, serverId: server.id } });
      await queryClient.invalidateQueries({ queryKey: ['admin-server', server.id] });
      await queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      return result;
    },
    onSuccess: () => toast.success('Serveur mis à jour'),
    onError: (error) => toast.error(error.message),
  });

  const form = useForm({
    validators: { onChange: updateAdminServerFormSchema },
    defaultValues: {
      name: server.name,
      ownerId: server.owner?.id ?? '',
      memoryMb: server.memoryMb,
      cpuCores: server.cpuCores,
      backupLimit: server.backupLimit,
    },
    onSubmit: ({ value }) => update.mutate(value),
  });

  const saveButton = (
    <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
      {([canSubmit, isSubmitting]) => (
        <Button type="submit" form="admin-server-record" disabled={!canSubmit || isSubmitting || update.isPending}>
          {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      )}
    </form.Subscribe>
  );

  const tabs: TabsCardTab[] = [
    /* ── Informations (Pelican "information" tab — name + owner editable) ── */
    {
      value: 'information',
      label: 'Informations',
      content: (
        <form
          id="admin-server-record"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <CardSection title="Identité">
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="name">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="admin-server-name">Nom</Label>
                    {canUpdate ? (
                      <Input
                        id="admin-server-name"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                    ) : (
                      <p className="py-2 font-medium">{field.state.value}</p>
                    )}
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">
                        {field.state.meta.errors[0]?.message}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="ownerId">
                {(field) => {
                  return (
                    <div className="space-y-2">
                      <Label>Propriétaire</Label>
                      {canUpdate ? (
                        canListUsers ? (
                          <div className="max-w-md">
                            <DataPicker
                            list={adminUsersList}
                            fetchPage={(query) => listUsers({ data: query })}
                            toSelection={(candidate) => ({
                              id: candidate.id,
                              name: candidate.name,
                              email: candidate.email,
                            })}
                            renderValue={(selection) =>
                              selection.name
                                ? `${selection.name} (${selection.email})`
                                : selection.email
                            }
                            value={ownerValue}
                            onChange={(selection) => {
                              setOwnerSelection(selection);
                              field.handleChange(selection?.id ?? '');
                            }}
                            title="Choisir un propriétaire"
                            placeholder="Rechercher un propriétaire"
                          />
                        </div>
                        ) : (
                          <p className="py-2 text-sm text-muted-foreground">
                            {server.owner?.email ?? '—'} — transfert non autorisé (permission
                            de lister les utilisateurs manquante)
                          </p>
                        )
                      ) : (
                        <p className="py-2 font-medium">
                          {server.owner ? `${server.owner.name ?? '—'} · ${server.owner.email}` : '—'}
                        </p>
                      )}
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-sm text-destructive">
                          {field.state.meta.errors[0]?.message}
                        </p>
                      )}
                    </div>
                  );
                }}
              </form.Field>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <InfoEntry label="UUID" value={<code className="text-xs">{server.id}</code>} />
              <InfoEntry label="Recette" value={`${server.recipe.name} (${server.recipe.slug})`} />
              <InfoEntry label="Node" value={server.node.name} />
              <InfoEntry label="Statut" value={statusLabel(server.status)} />
              <InfoEntry
                label="Suspension"
                value={server.suspended ? 'Suspendu' : 'Actif'}
                muted={!server.suspended}
              />
              <InfoEntry label="Sous-utilisateurs" value={String(server.subuserCount)} />
              <InfoEntry label="Sauvegardes" value={String(server.backupCount)} />
              <InfoEntry
                label="Créé le"
                value={new Date(server.createdAt).toLocaleString('fr-FR')}
              />
            </div>
          </CardSection>
          {canUpdate && <div className="mt-4">{saveButton}</div>}
        </form>
      ),
    },

    /* ── Ressources (Pelican "environment configuration" tab) ───────────── */
    {
      value: 'resources',
      label: 'Ressources',
      content: (
        <CardSection
          title="Limites de ressources"
          description="La mémoire et le CPU sont appliqués par l'agent à la prochaine (ré)installation complète — la limite de sauvegardes s'applique immédiatement."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <form.Field name="memoryMb">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="admin-server-memory">Mémoire (Mo)</Label>
                  {canUpdate ? (
                    <Input
                      id="admin-server-memory"
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                    />
                  ) : (
                    <p className="py-2 font-medium">{field.state.value} Mo</p>
                  )}
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="cpuCores">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="admin-server-cpu">CPU (cœurs, 0 = illimité)</Label>
                  {canUpdate ? (
                    <Input
                      id="admin-server-cpu"
                      type="number"
                      step="0.5"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                    />
                  ) : (
                    <p className="py-2 font-medium">
                      {field.state.value > 0 ? `${field.state.value} cœur(s)` : 'Illimité'}
                    </p>
                  )}
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="backupLimit">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="admin-server-backup-limit">Limite de sauvegardes</Label>
                  {canUpdate ? (
                    <Input
                      id="admin-server-backup-limit"
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                    />
                  ) : (
                    <p className="py-2 font-medium">
                      {field.state.value === 0 ? 'Désactivées' : String(field.state.value)}
                    </p>
                  )}
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {field.state.meta.errors[0]?.message}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          </div>
          {canUpdate && <div className="mt-4">{saveButton}</div>}
        </CardSection>
      ),
    },

    /* ── Allocations (Pelican AllocationsRelationManager) ───────────────── */
    {
      value: 'allocations',
      label: 'Allocations',
      content: <AdminServerAllocationsPanel serverId={server.id} canUpdate={canUpdate} />,
    },

    /* ── Actions (Pelican "actions" tab: suspend / reinstall / delete) ────── */
    {
      value: 'actions',
      label: 'Actions',
      content: (
        <ServerActionsPanel
          serverId={server.id}
          name={server.name}
          suspended={server.suspended}
          canUpdate={canUpdate}
          canDelete={canDelete}
        />
      ),
    },
  ];

  return <TabsCard defaultValue="information" className="mt-6" tabs={tabs} />;
}

/**
 * Allocations manager of the admin record (Pelican
 * AllocationsRelationManager): the server's allocations (set primary,
 * release) + the free pool of its node (claim).
 */
function AdminServerAllocationsPanel({
  serverId,
  canUpdate,
}: {
  serverId: string;
  canUpdate: boolean;
}) {
  const queryClient = useQueryClient();

  const listAllocations = useServerFn(listAdminServerAllocationsFn);
  const listFree = useServerFn(listAdminServerFreeAllocationsFn);
  const addAllocation = useServerFn(addAdminServerAllocationFn);
  const removeAllocation = useServerFn(removeAdminServerAllocationFn);
  const setPrimary = useServerFn(setPrimaryAdminServerAllocationFn);

  // The panel lives inside a tab, not a route — it owns its query state
  // instead of the URL search params (see the list contract).
  const [search, setSearch] = useState<ListQuery>(serverAllocationsList.defaultSearch);
  const onSearchChange = (patch: Partial<ListQuery>) =>
    setSearch((prev) => mergeQuery(prev, patch));

  const query = useQuery({
    queryKey: ['admin-server-allocations', serverId, search],
    queryFn: () => listAllocations({ data: { serverId, ...search } }),
    placeholderData: keepPreviousData,
  });
  const freeQuery = useQuery({
    queryKey: ['admin-server-allocations-free', serverId],
    queryFn: () => listFree({ data: { serverId } }),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-server-allocations', serverId] });
    await queryClient.invalidateQueries({ queryKey: ['admin-server-allocations-free', serverId] });
    await queryClient.invalidateQueries({ queryKey: ['admin-server', serverId] });
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
    validators: { onChange: adminServerAllocationActionSchema.pick({ allocationId: true }) },
    defaultValues: { allocationId: '' },
    onSubmit: ({ value }) => add.mutate(value.allocationId),
  });

  const free = freeQuery.data ?? [];
  const [allocationToRevoke, setAllocationToRevoke] = useState<ServerAllocationRow | null>(null);

  return (
    <div className="divide-y">
      <CardSection
        title="Allocations du serveur"
        description="Ports réseau affectés à ce serveur. L'allocation principale fournit SERVER_PORT et SERVER_IP — un changement s'applique au prochain démarrage."
      >
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
            canEdit: canUpdate,
            busy: primary.isPending || remove.isPending,
            onSetPrimary: (allocation) => primary.mutate(allocation.id),
            onRevoke: setAllocationToRevoke,
          }}
        />
      </CardSection>

      <CardSection
        title="Ajouter une allocation"
        description="Réclame un port libre dans le pool du node (Pelican : « Add allocation »)."
      >
        {canUpdate ? (
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
                      {/* Same base-ui caveat as the owner picker — resolve the
                          label ourselves, the item may not be mounted */}
                      <SelectValue placeholder="— Port disponible —">
                        {(value: string | null) => {
                          if (!value) return '— Port disponible —';
                          const allocation = free.find((a) => a.id === value);
                          if (!allocation) return '';
                          return `${allocation.ip}:${allocation.port}${
                            allocation.alias ? ` (${allocation.alias})` : ''
                          }`;
                        }}
                      </SelectValue>
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
                </div>
              )}
            </form.Field>
            <Button type="submit" disabled={add.isPending || free.length === 0}>
              Ajouter
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Lecture seule — la modification des allocations requiert la permission
            panel.servers.update.
          </p>
        )}
        {free.length === 0 && !freeQuery.isPending && (
          <p className="mt-2 text-sm text-muted-foreground">
            Aucune allocation libre sur ce node — crées-en dans la page du node.
          </p>
        )}
      </CardSection>

      <ConfirmDialog
        open={allocationToRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setAllocationToRevoke(null);
        }}
        onConfirm={() => {
          if (allocationToRevoke) remove.mutate(allocationToRevoke.id);
          setAllocationToRevoke(null);
        }}
        title={`Retirer l’allocation ${allocationToRevoke?.ip}:${allocationToRevoke?.port} ?`}
        description="Elle retournera dans le pool du node."
        confirmLabel="Retirer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}

/** Management actions (Pelican "actions" tab): suspend, reinstall, delete. */
function ServerActionsPanel({
  serverId,
  name,
  suspended,
  canUpdate,
  canDelete,
}: {
  serverId: string;
  name: string;
  suspended: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const setSuspended = useServerFn(setAdminServerSuspendedFn);
  const reinstall = useServerFn(reinstallAdminServerFn);
  const deleteServer = useServerFn(deleteAdminServerFn);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-server', serverId] });
    await queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
  };

  const suspend = useMutation({
    mutationFn: async (next: boolean) => {
      const result = await setSuspended({ data: { serverId, suspended: next } });
      await invalidate();
      return result;
    },
    onSuccess: (result) =>
      result.suspended
        ? toast.success('Serveur suspendu', {
            description: 'Le propriétaire et ses sous-utilisateurs n’ont plus accès au serveur.',
          })
        : toast.success('Serveur réactivé'),
    onError: (error) => toast.error(error.message),
  });

  const reinstallMutation = useMutation({
    mutationFn: async () => {
      const result = await reinstall({ data: { serverId } });
      await invalidate();
      return result;
    },
    onSuccess: (result) =>
      toast.success('Réinstallation démarrée', { description: result.message }),
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const result = await deleteServer({ data: { serverId } });
      await queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      return result;
    },
    onSuccess: async () => {
      toast.success('Serveur supprimé');
      await navigate({ to: '/admin/servers', search: adminServersList.defaultSearch });
    },
    onError: (error) => toast.error(error.message),
  });

  // Suspend asks for confirmation only when the server is NOT already
  // suspended — reactivation is immediate.
  const [confirmSuspendOpen, setConfirmSuspendOpen] = useState(false);
  const [confirmReinstallOpen, setConfirmReinstallOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (!canUpdate && !canDelete) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucune action disponible — permissions d’administration manquantes.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Suspension (Pelican Suspend/Unsuspend) ─── */}
      {canUpdate && (
        <CardSection
          title={suspended ? 'Réactiver le serveur' : 'Suspendre le serveur'}
          description={
            suspended
              ? 'Le propriétaire et ses sous-utilisateurs retrouvent l’accès au serveur, qui peut être redémarré.'
              : 'Un serveur suspendu est arrêté, ne peut plus être démarré, et son propriétaire et ses sous-utilisateurs perdent tout accès au serveur (panel, console, SFTP) — comme Pelican.'
          }
        >
          <Button
            variant={suspended ? 'outline' : 'destructive'}
            disabled={suspend.isPending}
            onClick={() => {
              if (suspended) {
                suspend.mutate(false);
              } else {
                setConfirmSuspendOpen(true);
              }
            }}
          >
            {suspend.isPending
              ? '…'
              : suspended
                ? 'Réactiver'
                : 'Suspendre'}
          </Button>
        </CardSection>
      )}

      {canUpdate && (
        <>
          <Separator />
          {/* ─── Reinstall (Pelican ReinstallServerService) ─── */}
          <CardSection
            title="Réinstaller le serveur"
            description="Réinstaller ce serveur l’arrêtera, puis relancera le script d’installation qui l’a configuré initialement."
          >
            <Button
              variant="destructive"
              disabled={reinstallMutation.isPending}
              onClick={() => setConfirmReinstallOpen(true)}
            >
              <RefreshCw className={reinstallMutation.isPending ? 'animate-spin' : undefined} />
              {reinstallMutation.isPending ? 'Démarrage…' : 'Réinstaller'}
            </Button>
          </CardSection>
        </>
      )}

      {canDelete && (
        <>
          <Separator />
          {/* ─── Deletion ─── */}
          <CardSection
            title="Supprimer le serveur"
            description="Supprime définitivement le serveur, son dossier sur le node, ses sauvegardes et ses sous-utilisateurs."
          >
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 />
              {remove.isPending ? 'Suppression…' : 'Supprimer'}
            </Button>
          </CardSection>
        </>
      )}
      <ConfirmDialog
        open={confirmSuspendOpen}
        onOpenChange={setConfirmSuspendOpen}
        onConfirm={() => {
          suspend.mutate(true);
          setConfirmSuspendOpen(false);
        }}
        title={`Suspendre « ${name} » ?`}
        description="Le serveur sera arrêté et son propriétaire perdra l’accès."
        confirmLabel="Suspendre"
        cancelLabel="Annuler"
        destructive
        pending={suspend.isPending}
      />

      <ConfirmDialog
        open={confirmReinstallOpen}
        onOpenChange={setConfirmReinstallOpen}
        onConfirm={() => {
          reinstallMutation.mutate();
          setConfirmReinstallOpen(false);
        }}
        title="Es-tu sûr de vouloir réinstaller ce serveur ?"
        description="Certains fichiers peuvent être supprimés ou modifiés pendant l’opération — pense à sauvegarder les données."
        confirmLabel="Réinstaller"
        cancelLabel="Annuler"
        destructive
        pending={reinstallMutation.isPending}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        onConfirm={() => {
          remove.mutate();
          setConfirmDeleteOpen(false);
        }}
        title={`Supprimer « ${name} » ?`}
        description="Le dossier sera effacé."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}

