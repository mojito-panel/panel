import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Download, Trash2 } from 'lucide-react';
import { parseRecipe } from '~/contract';
import { getRecipeFn, updateRecipeFn, deleteRecipeFn } from '~/server/functions/admin';
import { Button } from '~/components/ui/button';
import { RecipeEditor } from '~/components/recipe-editor/recipe-editor';
import {
  recipeEditorValueToRecipe,
  recipeToEditorValue,
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
      // List only — ['recipe'] is NOT invalidated so the form keeps its state
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRecipe({ data: { recipeId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
      await navigate({ to: '/admin/recipes' });
    },
  });

  if (query.isPending) {
    return <p className="text-muted-foreground">Chargement de la recette…</p>;
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
        <Button variant="ghost" render={<Link to="/admin/recipes" />}>
          ← Recettes
        </Button>
      </div>
    );
  }

  // Stored JSON → contract recipe (defaults applied) → editor value.
  // The whole page remounts via `key` when the server data changes.
  const initial = recipeToEditorValue(parseRecipe(JSON.parse(query.data.json)));

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

  return (
    <RecipeEditor
      key={`${query.data.id}-${query.dataUpdatedAt}`}
      title={query.data.name}
      initial={initial}
      onSubmit={(value) => update.mutate(value)}
      submitPending={update.isPending}
      submitError={update.isError ? update.error.message : null}
      headerActions={
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
            onClick={() => {
              if (confirm(`Supprimer la recette « ${query.data?.name} » ?`)) {
                remove.mutate();
              }
            }}
          >
            <Trash2 />
            Supprimer
          </Button>
        </>
      }
    />
  );
}
