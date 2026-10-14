import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { createRecipeFn } from '~/server/functions/admin';
import { RecipeEditor } from '~/components/recipe-editor/recipe-editor';
import { RuntimeRecipeEditor } from '~/components/recipe-editor/runtime-recipe-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  emptyRecipeEditorValue,
  recipeEditorValueToRecipe,
  runtimeEditorValueToRecipe,
  type RecipeEditorValue,
} from '~/validators/recipe-editor';

export const Route = createFileRoute('/admin/recipes/new/')({
  component: NewRecipePage,
});

function NewRecipePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createRecipe = useServerFn(createRecipeFn);

  // App recipes get the Pelican-style form editor; runtime recipes
  // are technical artifacts authored as raw JSON.
  const [kind, setKind] = useState<'app' | 'runtime'>('app');

  const createApp = useMutation({
    mutationFn: async (value: RecipeEditorValue) => {
      const { recipe, issues } = recipeEditorValueToRecipe(value);
      if (!recipe) {
        throw new Error(`Recette invalide : ${(issues ?? []).join(' · ')}`);
      }
      return createRecipe({ data: { json: JSON.stringify(recipe, null, 2) } });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
      await navigate({
        to: '/admin/recipes/$recipeId',
        params: { recipeId: result.id },
      });
    },
  });

  const createRuntime = useMutation({
    mutationFn: async (value: RecipeEditorValue) => {
      const { recipe, issues } = runtimeEditorValueToRecipe(value);
      if (!recipe) {
        throw new Error(`Recette invalide : ${(issues ?? []).join(' · ')}`);
      }
      return createRecipe({ data: { json: JSON.stringify(recipe, null, 2) } });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
      await navigate({
        to: '/admin/recipes/$recipeId',
        params: { recipeId: result.id },
      });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Type de recette</span>
        <Select value={kind} onValueChange={(value) => setKind(value as 'app' | 'runtime')}>
          <SelectTrigger id="new-recipe-kind" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="app">App (formulaire)</SelectItem>
            <SelectItem value="runtime">Runtime</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {kind === 'app' ? (
        <RecipeEditor
          title="Nouvelle recette"
          initial={emptyRecipeEditorValue()}
          onSubmit={(value) => createApp.mutate(value)}
          submitPending={createApp.isPending}
          submitError={createApp.isError ? createApp.error.message : null}
        />
      ) : (
        <RuntimeRecipeEditor
          title="Nouvelle recette runtime"
          initial={emptyRecipeEditorValue()}
          onSubmit={(value) => createRuntime.mutate(value)}
          submitPending={createRuntime.isPending}
          submitError={createRuntime.isError ? createRuntime.error.message : null}
        />
      )}
    </div>
  );
}
