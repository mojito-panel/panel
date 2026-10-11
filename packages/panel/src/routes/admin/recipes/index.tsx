import { useState, type FormEvent } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Pencil, Download, RefreshCw, Plus } from 'lucide-react';
import {
  listRecipesFn,
  importRecipesFn,
  getRecipeFn,
  deleteRecipeFn,
} from '~/server/functions/admin';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';

export const Route = createFileRoute('/admin/recipes/')({
  component: AdminRecipesPage,
});

type ImportMutationInput = { jsons: string[]; urls: string[] };

function AdminRecipesPage() {
  const queryClient = useQueryClient();
  const listRecipes = useServerFn(listRecipesFn);
  const importRecipes = useServerFn(importRecipesFn);
  const getRecipe = useServerFn(getRecipeFn);
  const deleteRecipe = useServerFn(deleteRecipeFn);

  const query = useQuery({ queryKey: ['recipes'], queryFn: () => listRecipes() });

  const importMutation = useMutation({
    mutationFn: (input: ImportMutationInput) => importRecipes({ data: input }),
  });

  const remove = useMutation({
    mutationFn: (recipeId: string) => deleteRecipe({ data: { recipeId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
  });

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
  const exportRecipe = async (recipeId: string, slug: string) => {
    const result = await getRecipe({ data: { recipeId } });
    const blob = new Blob([result.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recipe-${slug}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recettes</h1>
          <p className="text-muted-foreground">
            Eggs (format v2, compatible Pelican-like) installables sur les serveurs.
          </p>
        </div>
        <Button asChild>
          <Link to="/admin/recipes/new">
            <Plus />
            Créer une recette
          </Link>
        </Button>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
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
                  placeholder={'{\n  "schemaVersion": 2,\n  "id": "ma-recette",\n  …'}
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

        <div className="space-y-3">
          {(query.data ?? []).map((recipe) => (
            <div key={recipe.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{recipe.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {recipe.slug} · v{recipe.schemaVersion} ·{' '}
                    {recipe.variables.length} variable(s)
                  </p>
                  {recipe.updateUrl && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      MAJ : {recipe.updateUrl}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {recipe.updateUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Re-importer depuis l'URL de mise à jour"
                      disabled={importMutation.isPending}
                      onClick={() => updateFromUrl(recipe.updateUrl as string)}
                    >
                      <RefreshCw />
                      Mettre à jour
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" asChild>
                    <Link
                      to="/admin/recipes/$recipeId"
                      params={{ recipeId: recipe.id }}
                    >
                      <Pencil />
                      Éditer
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void exportRecipe(recipe.id, recipe.slug)}
                  >
                    <Download />
                    Exporter
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Supprimer la recette « ${recipe.name} » ?`)) {
                        remove.mutate(recipe.id);
                      }
                    }}
                  >
                    Supprimer
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {query.data?.length === 0 && (
            <p className="text-muted-foreground">Aucune recette importée.</p>
          )}
          {remove.isError && (
            <p className="text-sm text-destructive">{remove.error.message}</p>
          )}
        </div>
      </div>

      <p className="mt-8">
        <Button variant="ghost" asChild>
          <Link to="/servers">← Mes serveurs</Link>
        </Button>
      </p>
    </div>
  );
}
