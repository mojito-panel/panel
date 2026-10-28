import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  listRegistriesFn,
  addRegistryFn,
  syncRegistryFn,
  deleteRegistryFn,
  updateRegistryFn,
  type RegistryCardRow,
} from '~/server/functions/marketplace';
import { listSshKeysFn } from '~/server/functions/ssh-keys';
import { DataPicker } from '~/components/data-table/data-picker';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { CoverImage } from '~/components/cover-image';
import { adminSshKeysList, type AdminSshKeyRow } from '~/lists/ssh-keys';
import { useAuth } from '~/contexts/use-auth';
import { hasPermissions } from '~/lib/permissions';
import {
  addRegistrySchema,
  updateRegistrySchema,
  type AddRegistryDto,
  type UpdateRegistryDto,
} from '~/validators/marketplace';
import type { ListQuery, ListResult } from '~/lists/define';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';

export const Route = createFileRoute('/admin/marketplace/')({
  component: MarketplacePage,
});

/**
 * /admin/marketplace — the registries: git repositories of recipes, added
 * by URL, synced in the background (pg-boss), browsable CARD by card (one
 * click opens the catalog at /admin/marketplace/$registryId). A handful of
 * rows — no table, no filters: covers carry the page.
 */

/** The SSH key field of the add + edit forms (id in the form, name to show). */
type KeySelection = { id: string; name: string } | null;

function MarketplacePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  // Key NAMES travel in the card rows — the private keys never do. The key
  // PICKER (a DataPicker) needs the panel.keys read permission; without it
  // the field degrades to a plain-text note.
  const { user } = useAuth();
  const canManageKeys = hasPermissions(user?.permissions ?? [], { 'panel.keys': ['read'] });

  const listRegistries = useServerFn(listRegistriesFn);
  const addRegistry = useServerFn(addRegistryFn);
  const updateRegistry = useServerFn(updateRegistryFn);
  const syncRegistry = useServerFn(syncRegistryFn);
  const deleteRegistry = useServerFn(deleteRegistryFn);
  const listKeys = useServerFn(listSshKeysFn);

  const query = useQuery({
    queryKey: ['admin-registries'],
    queryFn: () => listRegistries(),
    // Syncs run as background jobs — poll until every registry landed its
    // first sync (the "Synchroniser" button also relies on fresh timestamps).
    refetchInterval: (current) =>
      current.state.data?.registries.some((registry) => registry.neverSynced) ? 4000 : false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-registries'] });

  const add = useMutation({
    mutationFn: async (data: AddRegistryDto) => {
      const result = await addRegistry({ data });
      await invalidate();
      return result;
    },
    onSuccess: () => {
      toast.success('Registre ajouté — première synchronisation en cours');
      form.reset();
      setAddKeySelection(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const sync = useMutation({
    mutationFn: (registryId: string) => syncRegistry({ data: { registryId } }),
    onMutate: async (registryId) => {
      // Optimistic: the card flips to "Synchronisation…" until the job lands.
      queryClient.setQueryData<{ registries: RegistryCardRow[] }>(
        ['admin-registries'],
        (previous) =>
          previous && {
            registries: previous.registries.map((registry) =>
              registry.id === registryId
                ? { ...registry, neverSynced: true, lastError: null }
                : registry,
            ),
          },
      );
    },
    onSuccess: async () => {
      await invalidate();
      toast.success('Synchronisation lancée');
    },
    onError: async (error) => {
      await invalidate();
      toast.error(error.message);
    },
  });

  const remove = useMutation({
    mutationFn: (registryId: string) => deleteRegistry({ data: { registryId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Registre supprimé — les recettes importées restent en place');
    },
    onError: (error) => toast.error(error.message),
  });

  const update = useMutation({
    mutationFn: (input: UpdateRegistryDto) => updateRegistry({ data: input }),
    onSuccess: async (result) => {
      await invalidate();
      toast.success(
        result.synced
          ? 'Registre mis à jour — resynchronisation lancée'
          : 'Registre mis à jour',
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const [registryToDelete, setRegistryToDelete] = useState<RegistryCardRow | null>(null);
  const [registryToEdit, setRegistryToEdit] = useState<RegistryCardRow | null>(null);
  /** Key selection of the ADD form (id in the form, name for the trigger). */
  const [addKeySelection, setAddKeySelection] = useState<KeySelection>(null);

  // Pelican-style layout: the add form only shows behind the header button
  const [showAdd, setShowAdd] = useState(false);

  const form = useForm({
    validators: { onChange: addRegistrySchema },
    defaultValues: { name: '', url: '', branch: '', sshKeyId: '' },
    onSubmit: ({ value }) => add.mutate(value),
  });

  const registries = query.data?.registries ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Marketplace</CardTitle>
          <CardDescription>
            Dépôts git de recettes : synchronisation automatique, import en un
            clic, mises à jour détectées par hachage du contenu.
          </CardDescription>
          <CardAction>
            <Button variant="outline" onClick={() => setShowAdd((v) => !v)}>
              <Plus />
              {showAdd ? 'Fermer' : 'Ajouter un registre'}
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      {/* ─── Registry cards — click one to browse its catalog ─── */}
      {query.isPending ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="aspect-[2/3] animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : registries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Aucun registre — ajoute un dépôt git de recettes (https public ou ssh).
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {registries.map((registry) => (
            <RegistryCardView
              key={registry.id}
              registry={registry}
              onOpen={() =>
                navigate({
                  to: '/admin/marketplace/$registryId',
                  params: { registryId: registry.id },
                })
              }
              onSync={() => sync.mutate(registry.id)}
              onEdit={() => setRegistryToEdit(registry)}
              onDelete={() => setRegistryToDelete(registry)}
            />
          ))}
        </div>
      )}

      {/* ─── Add a registry (hidden behind the list card's action button) ─── */}
      {showAdd && (
        <Card>
          <CardHeader>
            <CardTitle>Ajouter un registre</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="space-y-4"
            >
              <form.Field name="url">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="registry-url">URL du dépôt git</Label>
                    <Input
                      id="registry-url"
                      autoFocus
                      placeholder="https://github.com/mojito-panel/recipes ou git@github.com:mojito-panel/recipes.git"
                      value={field.state.value}
                      onChange={(e) => {
                        const value = e.target.value;
                        field.handleChange(value);
                        // Prefill the display name from the repository name.
                        const label = value.split('/').pop()?.replace(/\.git$/, '') ?? '';
                        if (label && !form.getFieldValue('name')) {
                          form.setFieldValue('name', label);
                        }
                      }}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">
                        {field.state.meta.errors[0]?.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      GitHub, GitLab, Gitea ou auto-hébergé — le clonage utilise
                      la commande <code>git clone</code> du panel (Git pour
                      Windows requis). Dépôts publics en https ; dépôts privés
                      en ssh via une clé (voir{' '}
                      <Link to="/admin/keys" className="underline hover:text-foreground">
                        Clés SSH
                      </Link>
                      ). La première synchronisation démarre dès l’ajout.
                    </p>
                  </div>
                )}
              </form.Field>

              <form.Field name="name">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="registry-name">Nom d’affichage</Label>
                    <Input
                      id="registry-name"
                      placeholder="Recettes officielles"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">
                        {field.state.meta.errors[0]?.message}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="branch">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="registry-branch">Branche suivie (optionnel)</Label>
                    <Input
                      id="registry-branch"
                      placeholder="main (défaut du dépôt)"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">
                        {field.state.meta.errors[0]?.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Laissée vide, la branche par défaut du dépôt est suivie.
                    </p>
                  </div>
                )}
              </form.Field>

              <form.Field name="sshKeyId">
                {() => (
                  <SshKeyPicker
                    label="Clé SSH (dépôt privé)"
                    listKeys={listKeys}
                    value={addKeySelection}
                    onChange={setAddKeySelection}
                  />
                )}
              </form.Field>

              <Button type="submit" className="w-full" disabled={add.isPending}>
                <Plus />
                {add.isPending ? 'Ajout…' : 'Ajouter et synchroniser'}
              </Button>
            </form>

            {add.isError && (
              <p className="mt-2 text-sm text-destructive">{add.error.message}</p>
            )}
          </CardContent>
        </Card>
      )}

      <EditRegistryDialog
        key={registryToEdit?.id ?? 'none'}
        registry={registryToEdit}
        canManageKeys={canManageKeys}
        listKeys={listKeys}
        update={update}
        onOpenChange={(open) => {
          if (!open) setRegistryToEdit(null);
        }}
      />

      <ConfirmDialog
        open={registryToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRegistryToDelete(null);
        }}
        onConfirm={() => {
          if (registryToDelete) remove.mutate(registryToDelete.id);
          setRegistryToDelete(null);
        }}
        title={`Supprimer le registre « ${registryToDelete?.name} » ?`}
        description="Les recettes déjà importées restent installées et vérifiables — seule la vue catalogue disparaît."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}

/** One registry card of the grid — cover (or gradient), counts, actions. */
function RegistryCardView({
  registry,
  onOpen,
  onSync,
  onEdit,
  onDelete,
}: {
  registry: RegistryCardRow;
  onOpen: () => void;
  onSync: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md">
      {/* ─── Cover — the repo-root artwork, or the seeded gradient ─── */}
      <button
        type="button"
        onClick={onOpen}
        title={`Ouvrir le catalogue de ${registry.name}`}
        className="relative block aspect-[2/3] w-full"
      >
        <CoverImage cover={registry.cover} seed={registry.id} />
        {registry.neverSynced && (
          <span className="absolute inset-x-0 bottom-0 bg-background/80 px-2 py-1 text-center text-xs text-muted-foreground">
            Synchronisation…
          </span>
        )}
      </button>

      <CardContent className="space-y-2 p-3">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full truncate text-left text-sm font-medium hover:underline"
          title={registry.name}
        >
          {registry.name}
        </button>
        <p className="truncate text-xs text-muted-foreground" title={registry.url}>
          {registry.url}
          {registry.branch ? ` · ${registry.branch}` : ''}
        </p>
        {registry.sshKeyName && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <KeyRound className="size-3 shrink-0" />
            <span className="truncate" title="Clé SSH du dépôt privé">
              {registry.sshKeyName}
            </span>
          </p>
        )}
        {registry.lastError && (
          <p className="line-clamp-2 text-xs text-destructive" title={registry.lastError}>
            {registry.lastError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">{registry.entryCount} recette(s)</span>
          {registry.updateAvailable > 0 && (
            <span className="font-medium text-primary">
              {registry.updateAvailable} à mettre à jour
            </span>
          )}
          {registry.modifiedLocally > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {registry.modifiedLocally} modifiée(s)
            </span>
          )}
          {registry.invalid > 0 && (
            <span className="text-destructive">{registry.invalid} invalide(s)</span>
          )}
          {registry.upstreamGone > 0 && (
            <span className="text-destructive">{registry.upstreamGone} supprimée(s)</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-1 pt-1">
          <span className="truncate text-xs text-muted-foreground">
            {registry.neverSynced
              ? 'Jamais synchronisé'
              : registry.lastSyncedAt?.toLocaleString('fr-FR')}
          </span>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Synchroniser maintenant"
              onClick={onSync}
            >
              <RefreshCw />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Modifier le nom, la branche ou la clé SSH"
              onClick={onEdit}
            >
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Supprimer" onClick={onDelete}>
              <Trash2 />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The SSH key field of a registry form — a DataPicker over the keys list
 * (the same server-paginated query as the /admin/keys page). Without the
 * panel.keys read permission the field degrades to a plain-text note.
 */
function SshKeyPicker({
  label,
  listKeys,
  value,
  onChange,
}: {
  label: string;
  listKeys: (args: { data: ListQuery }) => Promise<ListResult<AdminSshKeyRow>>;
  value: KeySelection;
  onChange: (selection: KeySelection) => void;
}) {
  const { user } = useAuth();
  const canManageKeys = hasPermissions(user?.permissions ?? [], { 'panel.keys': ['read'] });

  if (!canManageKeys) {
    return (
      <div className="space-y-2">
        <Label>Clé SSH (dépôt privé)</Label>
        <p className="py-2 text-sm text-muted-foreground">
          {value?.name ?? '—'} — permission de lister les clés manquante.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <DataPicker
        list={adminSshKeysList}
        fetchPage={(query) => listKeys({ data: query })}
        toSelection={(row) => ({ id: row.id, name: row.name })}
        renderValue={(selection) => selection.name}
        value={value}
        onChange={onChange}
        title="Choisir une clé SSH"
        placeholder="Aucune — dépôt public"
      />
      <p className="text-xs text-muted-foreground">
        Dépôt privé en ssh ? Sélectionne la clé de déploiement à utiliser pour
        le clonage —{' '}
        <Link to="/admin/keys" className="underline hover:text-foreground">
          gérer les clés
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * "Éditer" dialog of one registry — name, tracked branch and the SSH key of
 * a private repository. The URL (the registry's identity) is shown
 * read-only. A branch or key change re-enqueues a sync (the update fn
 * decides), so the catalog and the next clones follow immediately.
 */
function EditRegistryDialog({
  registry,
  canManageKeys,
  listKeys,
  update,
  onOpenChange,
}: {
  registry: RegistryCardRow | null;
  canManageKeys: boolean;
  listKeys: (args: { data: ListQuery }) => Promise<ListResult<AdminSshKeyRow>>;
  update: UseMutationResult<{ synced: boolean }, Error, UpdateRegistryDto>;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useForm({
    validators: { onChange: updateRegistrySchema },
    // The dialog is keyed by registry id (remount per registry) — the
    // defaults seed exactly once per edit session.
    defaultValues: {
      registryId: registry?.id ?? '',
      name: registry?.name ?? '',
      branch: registry?.branch ?? '',
      sshKeyId: registry?.sshKeyId ?? '',
    },
    onSubmit: ({ value }) => update.mutate(value),
  });

  // Key selection: id in the form, name for the trigger — seeded from the
  // card row (the DTO carries the current key's name).
  const [keySelection, setKeySelection] = useState<KeySelection>(
    registry?.sshKeyId ? { id: registry.sshKeyId, name: registry.sshKeyName ?? '' } : null,
  );

  return (
    <Dialog open={registry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifier « {registry?.name} »</DialogTitle>
          <DialogDescription>
            Le dépôt git est l’identité du registre — il ne change pas. Un
            changement de branche ou de clé relance une synchronisation.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="edit-registry-name">Nom d’affichage</Label>
                <Input
                  id="edit-registry-name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors[0]?.message}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <div className="space-y-2">
            <Label>Dépôt git (immuable)</Label>
            <p className="truncate rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground">
              {registry?.url ?? '—'}
            </p>
          </div>

          <form.Field name="branch">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="edit-registry-branch">Branche suivie</Label>
                <Input
                  id="edit-registry-branch"
                  placeholder="main (défaut du dépôt)"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">
                    {field.state.meta.errors[0]?.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Laissée vide, la branche par défaut du dépôt est suivie.
                </p>
              </div>
            )}
          </form.Field>

          <form.Field name="sshKeyId">
            {() => (
              <SshKeyPicker
                label="Clé SSH (dépôt privé)"
                listKeys={listKeys}
                value={keySelection}
                onChange={(selection) => {
                  setKeySelection(selection);
                  form.setFieldValue('sshKeyId', selection?.id ?? '');
                }}
              />
            )}
          </form.Field>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting || update.isPending}
                >
                  <Pencil />
                  {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>

        {update.isError && (
          <p className="mt-2 text-sm text-destructive">{update.error.message}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
