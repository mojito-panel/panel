import { useState, type FormEvent } from 'react';
import {
  createFileRoute,
  Link,
  stripSearchParams,
  useNavigate,
} from '@tanstack/react-router';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { Plus, Upload } from 'lucide-react';
import {
  listRecipesFn,
  importRecipesFn,
  importEggFn,
  getRecipeFn,
  deleteRecipeFn,
} from '~/server/functions/admin';
import { updateRecipeFromSourceFn } from '~/server/functions/marketplace';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { DataTable } from '~/components/data-table/data-table';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Textarea } from '~/components/ui/textarea';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { adminRecipesList, type AdminRecipeRow } from '~/lists/recipes';

/**
 * /admin/recipes — every recipe imported in the panel. Filtering, sorting and
 * pagination run in the database; the list definition (`~/lists/recipes`) holds
 * the columns AND the query it accepts, the state lives in the URL search params.
 */
export const Route = createFileRoute('/admin/recipes/')({
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    adminRecipesList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(adminRecipesList.defaultSearch)] },
  component: AdminRecipesPage,
});

type ImportMutationInput = { jsons: string[]; urls: string[] };

function AdminRecipesPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  const listRecipes = useServerFn(listRecipesFn);
  const importRecipes = useServerFn(importRecipesFn);
  const importEgg = useServerFn(importEggFn);
  const getRecipe = useServerFn(getRecipeFn);
  const deleteRecipe = useServerFn(deleteRecipeFn);
  const updateFromSource = useServerFn(updateRecipeFromSourceFn);

  const query = useQuery({
    queryKey: ['admin-recipes', search],
    queryFn: () => listRecipes({ data: search }),
    placeholderData: keepPreviousData,
  });

  const importMutation = useMutation({
    mutationFn: (input: ImportMutationInput) => importRecipes({ data: input }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
      // Summary toast (like the egg import) — the per-file detail list
      // stays rendered under the import form.
      toast.success('Import terminé', {
        description: `${result.imported.length} recette(s) importée(s), ${result.failed.length} en échec — détail sous le formulaire.`,
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const importEggMutation = useMutation({
    mutationFn: async (input: { json: string }) => {
      const result = await importEgg({ data: input });
      return result;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
      toast.success(`Œuf « ${result.name} » importé (${result.created ? 'créé' : 'mis à jour'})`);
      // The egg never maps fully (install scripts, features…) — every
      // warning is shown so the admin knows what to complete.
      for (const warning of result.warnings) toast.warning(warning);
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (recipeId: string) => deleteRecipe({ data: { recipeId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
      toast.success('Recette supprimée');
    },
    onError: (error) => toast.error(error.message),
  });

  /** Update one recipe from its source (registry, git clone or direct URL). */
  const updateSource = useMutation({
    mutationFn: (recipeId: string) => updateFromSource({ data: { recipeId } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
      toast.success(`Recette « ${result.name} » mise à jour depuis sa source`);
    },
    onError: (error) => toast.error(error.message),
  });

  // Pelican-style layout: the import panel only shows behind the header button
  const [showImport, setShowImport] = useState(false);

  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const [recipeToDelete, setRecipeToDelete] = useState<AdminRecipeRow | null>(null);


  /** Batch import: textarea + .json files + URL (each optional). */
  const onImportSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    const rawText = String(formData.get('recipeJson') ?? '').trim();
    const url = String(formData.get('recipeUrl') ?? '').trim();
    const files = formData
      .getAll('recipeFiles')
      .filter((f): f is File => f instanceof File && f.size > 0);

    // Egg import (PTDL_v2) — independent of the recipe JSONs above.
    const eggText = String(formData.get('eggJson') ?? '').trim();
    const eggFiles = formData
      .getAll('eggFiles')
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (eggText || eggFiles.length > 0) {
      importEggMutation.reset();
      const eggContents = await Promise.all(eggFiles.map((f) => f.text()));
      for (const json of [eggText, ...eggContents].filter((s) => s.length > 0)) {
        importEggMutation.mutate({ json });
      }
    }

    if (!rawText && !url && files.length === 0) return;

    const fileContents = await Promise.all(files.map((f) => f.text()));
    const jsons = [rawText, ...fileContents].filter((s) => s.length > 0);
    const urls = url ? [url] : [];

    importMutation.reset();
    importMutation.mutate({ jsons, urls });
    form.reset();
  };

  /** Update from the source — asks first when local changes would be overwritten. */
  const [recipeToUpdate, setRecipeToUpdate] = useState<AdminRecipeRow | null>(null);
  const onUpdateFromSource = (recipe: AdminRecipeRow) => {
    if (recipe.sourceStatus === 'modified_locally') {
      setRecipeToUpdate(recipe);
      return;
    }
    updateSource.mutate(recipe.id);
  };

  /** Export: downloads the recipe's raw JSON. */
  const exportRecipe = async (recipe: AdminRecipeRow) => {
    const result = await getRecipe({ data: { recipeId: recipe.id } });
    const blob = new Blob([result.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recipe-${recipe.slug}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="space-y-6">
      {/* ─── Recipe list — filtering/sorting/pagination run in the database ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Recettes</CardTitle>
          <CardDescription>
            Recettes (format v4, œufs Pelican importables) installables sur les serveurs.
          </CardDescription>
          <CardAction>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowImport((v) => !v)}>
                <Upload />
                {showImport ? 'Fermer' : 'Importer'}
              </Button>
              <Button render={<Link to="/admin/recipes/new" />}>
                <Plus />
                Créer une recette
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <DataTable
            list={adminRecipesList}
            rows={query.data?.rows ?? []}
            rowCount={query.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            emptyMessage="Aucune recette importée."
            rowContext={{
              importing: importMutation.isPending,
              deleting: remove.isPending,
              updating: updateSource.isPending,
              onUpdateFromSource: onUpdateFromSource,
              onExport: (recipe) => void exportRecipe(recipe),
              onDelete: setRecipeToDelete,
            }}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={recipeToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRecipeToDelete(null);
        }}
        onConfirm={async () => {
          if (!recipeToDelete) return;
          try {
            await remove.mutateAsync(recipeToDelete.id);
            setRecipeToDelete(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
        }}
        title={`Supprimer la recette « ${recipeToDelete?.name} » ?`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />

      {/* A source update overwrites local edits — the admin confirms first. */}
      <ConfirmDialog
        open={recipeToUpdate !== null}
        onOpenChange={(open) => {
          if (!open) setRecipeToUpdate(null);
        }}
        onConfirm={async () => {
          if (!recipeToUpdate) return;
          try {
            await updateSource.mutateAsync(recipeToUpdate.id);
            setRecipeToUpdate(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
        }}
        title={`« ${recipeToUpdate?.name} » a été modifiée localement`}
        description="Mettre à jour depuis la source écrasera les modifications locales — la recette redeviendra identique au fichier du registre."
        confirmLabel="Mettre à jour quand même"
        cancelLabel="Annuler"
        pending={updateSource.isPending}
      />

      {/* ─── Import panel (hidden behind the list card's action button) ─── */}
      {showImport && (
        <Card>
          <CardHeader>
            <CardTitle>Importer des recettes</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onImportSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recipeJson">JSON (texte)</Label>
                <Textarea
                  id="recipeJson"
                  name="recipeJson"
                  rows={8}
                  placeholder={'{\n  "schema_version": 4,\n  "id": "ma-recette",\n  …'}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="recipeFiles">Fichiers (.json)</Label>
                <input
                  id="recipeFiles"
                  name="recipeFiles"
                  type="file"
                  multiple
                  accept=".json,application/json"
                  className="flex w-full rounded-md border border-input bg-background p-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-xs file:text-secondary-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="recipeUrl">Depuis une URL</Label>
                <Input
                  id="recipeUrl"
                  name="recipeUrl"
                  type="url"
                  placeholder="https://github.com/…/blob/…/recipe.json"
                />
                <p className="text-xs text-muted-foreground">
                  Les URLs GitHub (blob) sont converties en raw automatiquement.
                </p>
              </div>

              {/* ─── Egg import (PTDL_v2) — mapped, install scripts ignored ─── */}
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="eggJson">Œuf Pelican (PTDL_v2, texte)</Label>
                <Textarea
                  id="eggJson"
                  name="eggJson"
                  rows={4}
                  placeholder={'{\n  "meta": { "version": "PTDL_v2" },\n  …'}
                  className="font-mono text-xs"
                />
                <Label htmlFor="eggFiles">Fichiers d'œuf (.json)</Label>
                <input
                  id="eggFiles"
                  name="eggFiles"
                  type="file"
                  multiple
                  accept=".json,application/json"
                  className="flex w-full rounded-md border border-input bg-background p-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-xs file:text-secondary-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Variables, démarrage/arrêt, fichiers de config et image Docker sont
                  importés — les scripts d'installation sont ignorés (la section
                  Installation est à réécrire avec les actions déclaratives).
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={importMutation.isPending}
              >
                {importMutation.isPending ? 'Import…' : 'Importer'}
              </Button>
            </form>

            {importMutation.isError && (
              <p className="mt-2 text-sm text-destructive">{importMutation.error.message}</p>
            )}

            {importMutation.data && (
              <div className="mt-3 space-y-2 text-sm">
                {importMutation.data.imported.length > 0 && (
                  <ul className="space-y-1 text-green-600">
                    {importMutation.data.imported.map((p) => (
                      <li key={`${p.slug}-${p.source}`}>
                        « {p.name} » ({p.slug}) — {p.created ? 'créé' : 'mis à jour'}
                      </li>
                    ))}
                  </ul>
                )}
                {importMutation.data.failed.length > 0 && (
                  <ul className="space-y-1 text-destructive">
                    {importMutation.data.failed.map((f) => (
                      <li key={f.source}>
                        {f.source} : {f.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
