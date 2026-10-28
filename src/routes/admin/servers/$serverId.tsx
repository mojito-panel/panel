import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import {
  getAdminServerFn,
  getAdminServerStatusFn,
  updateAdminServerFn,
  setAdminServerSuspendedFn,
  reinstallAdminServerFn,
  reloadAdminServerRecipeFn,
  changeAdminServerRecipeFn,
  deleteAdminServerFn,
  listAdminServerAllocationsFn,
  listAdminServerFreeAllocationsFn,
  addAdminServerAllocationFn,
  removeAdminServerAllocationFn,
  setPrimaryAdminServerAllocationFn,
} from '~/server/functions/admin-servers';
import { listRecipeOptionsFn } from '~/server/functions/admin';
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
import { StatusBadge, isLiveData, statusLabel } from '~/components/status-badge';
import { CardSection, TabsCard, type TabsCardTab } from '~/components/tabs-card';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Separator } from '~/components/ui/separator';
import { Skeleton } from '~/components/ui/skeleton';
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
  suspended: boolean;
  memoryMb: number;
  cpuCores: number;
  backupLimit: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  node: { id: string; name: string; fqdn: string; sftpPort: number };
  recipe: {
    id: string;
    name: string;
    slug: string;
    updatedAt: Date | string;
    syncedAt?: Date | string | null;
  };
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

  // LIVE runtime status — ONE agent query polled at a regular interval
  // (like the node page's health ping); pending → the badge shows a
  // skeleton, never blocks the page. The DB status is the fallback.
  const getStatus = useServerFn(getAdminServerStatusFn);
  const statusQuery = useQuery({
    queryKey: ['admin-server-status', serverId],
    queryFn: () => getStatus({ data: { serverId } }),
    refetchInterval: 5000,
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
            <h1 className="text-3xl leading-none font-bold tracking-tight">{server.name}</h1>
            {statusQuery.isPending ? (
              <Skeleton className="h-6 w-24 rounded-full" />
            ) : (
              // Sonar rings only when the AGENT answered within the last
              // 20 s — the fn serves the DB status when it cannot (live=false).
              <StatusBadge
                status={statusQuery.data?.status ?? server.status}
                live={(statusQuery.data?.live ?? false) && isLiveData(statusQuery)}
              />
            )}
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
  // undefined = untouched (falls back to the server's owner), null = cleared by
  // the picker, object = picked. The form field mirrors it: '' when cleared.
  const [ownerSelection, setOwnerSelection] = useState<OwnerSelection | null | undefined>(undefined);
  const ownerValue =
    ownerSelection !== undefined
      ? ownerSelection
      : server.owner
        ? { id: server.owner.id, name: server.owner.name, email: server.owner.email }
        : null;

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
        <Button type="submit" disabled={!canSubmit || isSubmitting || update.isPending}>
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
        // Its own <form> — inactive tab panels UNMOUNT (base-ui), so a form
        // element living in another tab cannot be referenced from here: the
        // save button submits the form it is rendered inside.
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
        <CardSection
          title="Limites de ressources"
          description="La mémoire et le CPU sont poussés à l'agent au prochain démarrage (start/restart) — la limite de sauvegardes s'applique immédiatement."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <form.Field name="memoryMb">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="admin-server-memory">Mémoire (Mo, 0 = illimité)</Label>
                  {canUpdate ? (
                    <Input
                      id="admin-server-memory"
                      type="number"
                      min="0"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                      onBlur={field.handleBlur}
                    />
                  ) : (
                    <p className="py-2 font-medium">
                      {field.state.value === 0 ? 'Illimité' : `${field.state.value} Mo`}
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
        </form>
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
          recipeId={server.recipe.id}
          recipeName={server.recipe.name}
          recipeUpdatedAt={server.recipe.updatedAt}
          recipeSyncedAt={server.recipe.syncedAt}
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

/** Management actions (Pelican "actions" tab): suspend, reinstall, reload/change recipe, delete. */
function ServerActionsPanel({
  serverId,
  name,
  recipeId,
  recipeName,
  recipeUpdatedAt,
  recipeSyncedAt,
  suspended,
  canUpdate,
  canDelete,
}: {
  serverId: string;
  name: string;
  recipeId: string;
  recipeName: string;
  recipeUpdatedAt: Date | string;
  recipeSyncedAt: Date | string | null | undefined;
  suspended: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const setSuspended = useServerFn(setAdminServerSuspendedFn);
  const reinstall = useServerFn(reinstallAdminServerFn);
  const reloadRecipe = useServerFn(reloadAdminServerRecipeFn);
  const changeRecipe = useServerFn(changeAdminServerRecipeFn);
  const deleteServer = useServerFn(deleteAdminServerFn);
  const listRecipeOptions = useServerFn(listRecipeOptionsFn);

  // Recipe picker options — only loaded when the change dropdown is usable
  const recipesQuery = useQuery({
    queryKey: ['recipe-options'],
    queryFn: () => listRecipeOptions(),
    enabled: canUpdate,
  });

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

  const reloadMutation = useMutation({
    mutationFn: async () => {
      const result = await reloadRecipe({ data: { serverId } });
      await invalidate();
      return result;
    },
    onSuccess: () =>
      toast.success('Recette rechargée', {
        description:
          'Les variables du serveur sont à jour — réinstalle le serveur pour appliquer la nouvelle version.',
      }),
    onError: (error) => toast.error(error.message),
  });

  const changeMutation = useMutation({
    mutationFn: async (targetRecipeId: string) => {
      const result = await changeRecipe({ data: { serverId, recipeId: targetRecipeId } });
      await invalidate();
      return result;
    },
    onSuccess: (result) =>
      toast.success('Changement de recette démarré', { description: result.message }),
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (force: boolean) => {
      const result = await deleteServer({ data: { serverId, force } });
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
  const [confirmReloadOpen, setConfirmReloadOpen] = useState(false);
  const [confirmChangeOpen, setConfirmChangeOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmForceDeleteOpen, setConfirmForceDeleteOpen] = useState(false);

  // Change-recipe dropdown selection (empty = nothing picked yet)
  const [targetRecipeId, setTargetRecipeId] = useState('');
  const targetRecipe = recipesQuery.data?.find((r) => r.id === targetRecipeId);

  // The reload button only appears when the recipe row changed after the
  // server's snapshot — no update, nothing to propagate.
  const recipeUpdatedSinceSnapshot =
    !!recipeSyncedAt && new Date(recipeUpdatedAt) > new Date(recipeSyncedAt);

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

          <Separator />

          {/* ─── Reload recipe (recipe updated since the server's snapshot) ─── */}
          <CardSection
            title="Recharger la recette"
            description={
              recipeUpdatedSinceSnapshot
                ? `La recette « ${recipeName} » a été modifiée depuis l’installation de ce serveur — la recharger met à jour ses variables ; réinstalle ensuite le serveur pour l’appliquer.`
                : `La recette « ${recipeName} » n’a pas changé depuis l’application sur ce serveur — rien à recharger.`
            }
          >
            {recipeUpdatedSinceSnapshot ? (
              <Button
                variant="outline"
                disabled={reloadMutation.isPending}
                onClick={() => setConfirmReloadOpen(true)}
              >
                <RefreshCw className={reloadMutation.isPending ? 'animate-spin' : undefined} />
                {reloadMutation.isPending ? 'Rechargement…' : 'Recharger la recette'}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                {recipeSyncedAt
                  ? `Dernière version appliquée le ${new Date(recipeSyncedAt).toLocaleString('fr-FR')}.`
                  : 'Version appliquée inconnue (serveur antérieur aux instantanés).'}
              </p>
            )}
          </CardSection>

          <Separator />

          {/* ─── Change recipe (re-snapshot from another recipe + reinstall) ─── */}
          <CardSection
            title="Changer de recette"
            description="Le serveur passera à la recette choisie et sera réinstallé avec — les variables gardent leurs valeurs pour les noms d’environnement que la nouvelle recette déclare encore."
          >
            <div className="flex w-full max-w-md gap-2">
              <Select value={targetRecipeId} onValueChange={(value) => setTargetRecipeId(value ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choisir une recette" />
                </SelectTrigger>
                <SelectContent>
                  {(recipesQuery.data ?? []).map((recipe) => (
                    <SelectItem
                      key={recipe.id}
                      value={recipe.id}
                      disabled={recipe.id === recipeId}
                    >
                      {recipe.name}
                      {recipe.id === recipeId ? ' (actuelle)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!targetRecipeId || targetRecipeId === recipeId || changeMutation.isPending}
                onClick={() => setConfirmChangeOpen(true)}
              >
                {changeMutation.isPending ? 'Application…' : 'Appliquer'}
              </Button>
            </div>
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
            {remove.isError && (
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => setConfirmForceDeleteOpen(true)}
              >
                Supprimer quand même
              </Button>
            )}
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
        open={confirmReloadOpen}
        onOpenChange={setConfirmReloadOpen}
        onConfirm={() => {
          reloadMutation.mutate();
          setConfirmReloadOpen(false);
        }}
        title={`Recharger la recette « ${recipeName} » ?`}
        description="La version actuelle de la recette remplacera celle utilisée à l’installation. Rien n’est réinstallé à cette étape — ajuste les variables du serveur, puis réinstalle-le pour appliquer la nouvelle version."
        confirmLabel="Recharger"
        cancelLabel="Annuler"
        destructive
        pending={reloadMutation.isPending}
      />

      <ConfirmDialog
        open={confirmChangeOpen}
        onOpenChange={setConfirmChangeOpen}
        onConfirm={() => {
          if (targetRecipeId) changeMutation.mutate(targetRecipeId);
          setConfirmChangeOpen(false);
        }}
        title={
          targetRecipe
            ? `Passer « ${name} » de « ${recipeName} » à « ${targetRecipe.name} » ?`
            : ''
        }
        description="Le serveur sera réinstallé avec la nouvelle recette — les fichiers peuvent être modifiés ou supprimés, et les étapes d’installation de la nouvelle recette s’appliqueront. Pense à sauvegarder les données."
        confirmLabel="Changer et réinstaller"
        cancelLabel="Annuler"
        destructive
        pending={changeMutation.isPending}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        onConfirm={() => {
          remove.mutate(false);
          setConfirmDeleteOpen(false);
        }}
        title={`Supprimer « ${name} » ?`}
        description="Le dossier sera effacé."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />

      <ConfirmDialog
        open={confirmForceDeleteOpen}
        onOpenChange={setConfirmForceDeleteOpen}
        onConfirm={() => {
          remove.mutate(true);
          setConfirmForceDeleteOpen(false);
        }}
        title={`Supprimer « ${name} » sans l’agent ?`}
        description="L’agent est injoignable : le serveur sera supprimé du panel, mais son dossier et son conteneur resteront sur le node — ils seront nettoyés automatiquement dès que le node répondra à nouveau."
        confirmLabel="Supprimer quand même"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}

