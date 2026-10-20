import { z } from 'zod';

/**
 * Zod schemas for the recipe server functions (import/edit/export).
 * The recipe JSON itself is validated by the contract's `parseRecipe` (v1 schema).
 */

export const importRecipesSchema = z
  .object({
    /** Raw JSONs (textarea or .json file contents). */
    jsons: z.array(z.string().min(1)).max(10).optional(),
    /** Recipe .json URLs (github.com/blob → raw converted server-side). */
    urls: z.array(z.string().url()).max(10).optional(),
  })
  .refine((d) => (d.jsons?.length ?? 0) + (d.urls?.length ?? 0) > 0, {
    message: 'Fournir au moins un JSON ou une URL',
    path: ['jsons'],
  });

export type ImportRecipesDto = z.infer<typeof importRecipesSchema>;

export const importEggSchema = z.object({
  /** Raw PTDL_v2 egg JSON (textarea or .json file content). */
  json: z.string().min(1, 'Le JSON de l’œuf est requis'),
});

export type ImportEggDto = z.infer<typeof importEggSchema>;

export const getRecipeSchema = z.object({
  recipeId: z.string().min(1),
});

export type GetRecipeDto = z.infer<typeof getRecipeSchema>;

export const createRecipeSchema = z.object({
  /** New recipe JSON — fully revalidated by `parseRecipe`. */
  json: z.string().min(1, 'Le JSON de la recette est requis'),
});

export type CreateRecipeDto = z.infer<typeof createRecipeSchema>;

export const updateRecipeSchema = z.object({
  recipeId: z.string().min(1),
  /** Modified recipe JSON — fully revalidated by `parseRecipe`. */
  json: z.string().min(1, 'Le JSON de la recette est requis'),
});

export type UpdateRecipeDto = z.infer<typeof updateRecipeSchema>;

export const deleteRecipeSchema = z.object({
  recipeId: z.string().min(1),
});
