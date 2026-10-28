import { useState } from 'react';
import { createFileRoute, Link, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { Plus, Store } from 'lucide-react';
import {
  listRegistriesFn,
  addRegistryFn,
  syncRegistryFn,
  deleteRegistryFn,
} from '~/server/functions/marketplace';
import { ListTable } from '~/components/data-table/list-table';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { mergeQuery, type ListQuery } from '~/lists/define';
import {
  adminRegistriesList,
  type AdminRegistryRow,
} from '~/lists/registries';
import { addRegistrySchema, type AddRegistryDto } from '~/validators/marketplace';
import { adminRecipesList } from '~/lists/recipes';
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

export const Route = createFileRoute('/admin/marketplace/')({
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    adminRegistriesList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(adminRegistriesList.defaultSearch)] },
  component: MarketplacePage,
});

/**
 * /admin/marketplace — the registries: public git repositories of recipes,
 * added by URL, synced in the background (pg-boss), browsable and importable
 * one click at a time. The sync itself is asynchronous — the page polls
 * while any registry has never been synced.
 */
function MarketplacePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();

  const listRegistries = useServerFn(listRegistriesFn);
  const addRegistry = useServerFn(addRegistryFn);
  const syncRegistry = useServerFn(syncRegistryFn);
  const deleteRegistry = useServerFn(deleteRegistryFn);

  const query = useQuery({
    queryKey: ['admin-registries'],
    queryFn: () => listRegistries(),
    // Syncs run as background jobs — poll until every registry landed its
    // first sync (the button "Synchroniser" also relies on fresh timestamps).
    refetchInterval: (query) =>
      query.state.data?.registries.some((registry) => registry.neverSynced) ? 4000 : false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-registries'] });

  const add = useMutation({
    mutationFn: async (data: AddRegistryDto) => {
      const result = await addRegistry({ data });
      await invalidate();
      return result;
    },
    onSuccess: () => toast.success('Registre ajouté — première synchronisation en cours'),
    onError: (error) => toast.error(error.message),
  });

  const sync = useMutation({
    mutationFn: (registryId: string) => syncRegistry({ data: { registryId } }),
    onMutate: async (registryId) => {
      // Optimistic: the row flips to "Synchronisation…" until the job lands.
      queryClient.setQueryData<{ registries: AdminRegistryRow[] }>(
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

  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const [registryToDelete, setRegistryToDelete] = useState<AdminRegistryRow | null>(null);

  // Pelican-style layout: the add form only shows behind the header button
  const [showAdd, setShowAdd] = useState(false);

  const form = useForm({
    validators: { onChange: addRegistrySchema },
    defaultValues: { name: '', url: '', branch: '' },
    onSubmit: ({ value }) => add.mutate(value),
  });

  return (
    <div className="space-y-6">
      {/* ─── Registries — filtering/sorting run in the browser ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Marketplace</CardTitle>
          <CardDescription>
            Dépôts git publics de recettes : synchronisation automatique, import
            en un clic, mises à jour détectées par hachage du contenu.
          </CardDescription>
          <CardAction>
            <Button variant="outline" onClick={() => setShowAdd((v) => !v)}>
              <Plus />
              {showAdd ? 'Fermer' : 'Ajouter un registre'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ListTable
            list={adminRegistriesList}
            rows={query.data?.registries ?? []}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            emptyMessage="Aucun registre — ajoute un dépôt git de recettes (https public ou ssh)."
            rowContext={{
              syncing: sync.isPending,
              deleting: remove.isPending,
              onSync: (registry) => sync.mutate(registry.id),
              onDelete: setRegistryToDelete,
            }}
          />
        </CardContent>
      </Card>

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
                      en ssh (<code>git@hôte:chemin</code> ou{' '}
                      <code>ssh://…</code>) via les clés et la configuration
                      ssh du panel. La première synchronisation démarre dès
                      l’ajout.
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

              <Button type="submit" className="w-full" disabled={add.isPending}>
                <Store />
                {add.isPending ? 'Ajout…' : 'Ajouter et synchroniser'}
              </Button>
            </form>

            {add.isError && (
              <p className="mt-2 text-sm text-destructive">{add.error.message}</p>
            )}
          </CardContent>
        </Card>
      )}

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

      <p className="text-xs text-muted-foreground">
        Les recettes importées depuis un registre apparaissent dans{' '}
        <Link
          to="/admin/recipes"
          search={adminRecipesList.defaultSearch}
          className="underline hover:text-foreground"
        >
          Recettes
        </Link>
        , avec leur statut de mise à jour.
      </p>
    </div>
  );
}
