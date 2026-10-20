import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { createRecipeFn } from '~/server/functions/admin';
import { RecipeEditor } from '~/components/recipe-editor/recipe-editor';
import {
  emptyRecipeEditorValue,
  recipeEditorValueToRecipe,
  type RecipeEditorValue,
} from '~/validators/recipe-editor';

export const Route = createFileRoute('/admin/recipes/new/')({
  component: NewRecipePage,
});

function NewRecipePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createRecipe = useServerFn(createRecipeFn);

  const create = useMutation({
    mutationFn: async (value: RecipeEditorValue) => {
      const { recipe, issues } = recipeEditorValueToRecipe(value);
      if (!recipe) {
        throw new Error(`Recette invalide : ${(issues ?? []).join(' · ')}`);
      }
      return createRecipe({ data: { json: JSON.stringify(recipe, null, 2) } });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-recipes'] });
      await queryClient.invalidateQueries({ queryKey: ['recipe-options'] });
      await navigate({
        to: '/admin/recipes/$recipeId',
        params: { recipeId: result.id },
      });
    },
  });

  return (
    <RecipeEditor
      title="Nouvelle recette"
      initial={emptyRecipeEditorValue()}
      onSubmit={(value) => create.mutate(value)}
      submitPending={create.isPending}
      submitError={create.isError ? create.error.message : null}
    />
  );
}
