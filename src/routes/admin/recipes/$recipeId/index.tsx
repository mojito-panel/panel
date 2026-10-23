import { useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';

import { Download, Trash2 } from 'lucide-react';
import { isRuntimeRecipeJson, parseRecipe, parseRuntimeRecipe } from '~/contract';
import { getRecipeFn, updateRecipeFn, deleteRecipeFn } from '~/server/functions/admin';
import { adminRecipesList } from '~/lists/recipes';
import { Button } from '~/components/ui/button';
import { RecipeEditor } from '~/components/recipe-editor/recipe-editor';
import {
  recipeEditorValueToRecipe,
  recipeToEditorValue,
  runtimeToEditorValue,
  type RecipeEditorValue,
} from '~/validators/recipe-editor';

export const Route = createFileRoute('/admin/recipes/$recipeId/')({
  component: EditRecipePage,
});

function EditRecipePage() {
  const { recipeId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const getRecipe = useServerFn(getRecipeFn);
  const updateRecipe = useServerFn(updateRecipeFn);
  const deleteRecipe = useServerFn(deleteRecipeFn);

  const query = useQuery({
    queryKey: ['recipe', recipeId],
    queryFn: () => getRecipe({ data: { recipeId } }),
    // The editor hydrates from this query — never serve a stale entry
    // (the global staleTime is 60s): rehydrating the form from an
    // outdated cache and re-saving would silently overwrite the row
    // with the pre-edit content.
    staleTime: 0,
  });

  const update = useMutation({
    mutationFn: async (value: RecipeEditorValue) => {
      const { recipe, issues } = recipeEditorValueToRecipe(value);
      if (!recipe) {
        throw new Error(`Recette invalide : ${(issues ?? []).join(' · ')}`);
      }
      return updateRecipe({ data: { recipeId, json: JSON.stringify(recipe, null, 2) } });
    },
    onSuccess: async () => {
      // Invalidate the detail too: the refetch bumps `dataUpdatedAt`, the
      // `key` below remounts the editor and the form RESETS with the data
      // the server actually stored (defaults applied, slug renamed…).
      await queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
      await queryClient.invalidateQueries({ queryKey: ['recipe-options'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRecipe({ data: { recipeId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
      await queryClient.invalidateQueries({ queryKey: ['recipe-options'] });
      await navigate({ to: '/admin/recipes', search: adminRecipesList.defaultSearch });
    },
  });
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (query.isPending) {
    return <p className="text-muted-foreground">Chargement de la recette…</p>;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
        <Button
          variant="ghost"
          render={<Link to="/admin/recipes" search={adminRecipesList.defaultSearch} />}
        >
          ← Recettes
        </Button>
      </div>
    );
  }

  /** Export: downloads the stored JSON (Pelican's ExportEggAction). */
  const exportRecipe = () => {
    const blob = new Blob([query.data?.json ?? ''], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recipe-${query.data?.slug ?? 'export'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const headerActions = (
    <>
      <Button
        variant="outline"
        onClick={() => void exportRecipe()}
        title="Exporter le JSON de la recette"
      >
        <Download />
        Exporter
      </Button>
      <Button
        variant="destructive"
        disabled={remove.isPending}
        onClick={() => setConfirmDeleteOpen(true)}
      >
        <Trash2 />
        Supprimer
      </Button>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        onConfirm={() => {
          remove.mutate();
          setConfirmDeleteOpen(false);
        }}
        title={`Supprimer la recette « ${query.data?.name} » ?`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </>
  );

  // Stored JSON → contract recipe (defaults applied) → editor value.
  // Runtime recipes hydrate through their own conversion (no start).
  // The whole page remounts via `key` when the server data changes.
  const storedJson = JSON.parse(query.data.json);
  const initial = isRuntimeRecipeJson(storedJson)
    ? runtimeToEditorValue(parseRuntimeRecipe(storedJson))
    : recipeToEditorValue(parseRecipe(storedJson));

  return (
    <RecipeEditor
      key={`${query.data.id}-${query.dataUpdatedAt}`}
      title={query.data.name}
      initial={initial}
      onSubmit={(value) => update.mutate(value)}
      submitPending={update.isPending}
      submitError={update.isError ? update.error.message : null}
      headerActions={headerActions}
    />
  );
}
