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
  getRecipeFn,
  deleteRecipeFn,
} from '~/server/functions/admin';
import { DataTable } from '~/components/data-table/data-table';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
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
  const getRecipe = useServerFn(getRecipeFn);
  const deleteRecipe = useServerFn(deleteRecipeFn);

  const query = useQuery({
    queryKey: ['admin-recipes', search],
    queryFn: () => listRecipes({ data: search }),
    placeholderData: keepPreviousData,
  });

  const importMutation = useMutation({
    mutationFn: (input: ImportMutationInput) => importRecipes({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
    },
  });

  const remove = useMutation({
    mutationFn: (recipeId: string) => deleteRecipe({ data: { recipeId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
      toast.success('Recette supprimée');
    },
    onError: (error) => toast.error(error.message),
  });

  // Pelican-style layout: the import panel only shows behind the header button
  const [showImport, setShowImport] = useState(false);

  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const onDelete = (recipe: AdminRecipeRow) => {
    if (confirm(`Supprimer la recette « ${recipe.name} » ?`)) {
      remove.mutate(recipe.id);
    }
  };

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

    if (!rawText && !url && files.length === 0) return;

    const fileContents = await Promise.all(files.map((f) => f.text()));
    const jsons = [rawText, ...fileContents].filter((s) => s.length > 0);
    const urls = url ? [url] : [];

    importMutation.reset();
    importMutation.mutate({ jsons, urls });
    form.reset();
  };

  /** Re-import from the recipe's updateUrl (upsert — same behavior as Pelican). */
  const updateFromUrl = (url: string) => {
    importMutation.reset();
    importMutation.mutate({ jsons: [], urls: [url] });
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
      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recettes</h1>
          <p className="text-muted-foreground">
            Eggs (format v1, compatible Pelican-like) installables sur les serveurs.
          </p>
        </div>
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
      </div>

      {/* ─── Import panel (hidden behind the header button) ─── */}
      {showImport && (
        <Card>
          <CardHeader>
            <CardTitle>Importer des recettes</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onImportSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recipeJson">JSON (texte)</Label>
                <textarea
                  id="recipeJson"
                  name="recipeJson"
                  rows={8}
                  placeholder={'{\n  "schemaVersion": 1,\n  "type": "app",\n  "id": "ma-recette",\n  …'}
                  className="flex w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
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

      {/* ─── Recipe list ─── */}
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
          onUpdateFromUrl: (url) => updateFromUrl(url),
          onExport: (recipe) => void exportRecipe(recipe),
          onDelete,
        }}
      />
    </div>
  );
}
