import { z } from 'zod';

/**
 * Zod schemas for the marketplace server functions (registries, catalog
 * imports, source updates). The recipe JSON itself is validated by the
 * contract's `parseRecipe`.
 */

/** Git ref — empty (repository default) or a simple branch/tag name. */
const GIT_REF_PATTERN = /^[A-Za-z0-9._/-]{0,128}$/;

/**
 * Git remote shapes: https or ssh URLs, or the SCP shorthand `git@host:path`.
 * The service (`canonicalGitUrl`) does the strict validation — this only
 * keeps obvious garbage out of the form.
 */
const GIT_REMOTE_PATTERN =
  /^(?:(?:https|ssh):\/\/\S+|[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:\S+)$/;

export const addRegistrySchema = z.object({
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  /** Git URL of the repository — https (public) or ssh (panel host keys). */
  url: z
    .string()
    .min(5, 'URL du dépôt requise')
    .max(2048)
    .refine((v) => GIT_REMOTE_PATTERN.test(v), 'Doit être une URL de dépôt git : https://…, ssh://… ou git@hôte:chemin'),
  /** Branch to track — empty = the repository's default branch. */
  branch: z
    .string()
    .max(128)
    .refine((v) => GIT_REF_PATTERN.test(v), 'Nom de branche invalide'),
  /** SSH key for a PRIVATE repository — '' = none (public https). The form
   * always carries the field, so the schema requires it. */
  sshKeyId: z.string().trim().max(64),
});

export type AddRegistryDto = z.infer<typeof addRegistrySchema>;

export const registryIdSchema = z.object({
  registryId: z.string().min(1),
});

export type RegistryIdDto = z.infer<typeof registryIdSchema>;

/** Editable fields of a registry (the URL is its identity — immutable). */
export const updateRegistrySchema = z.object({
  registryId: z.string().min(1),
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  branch: z
    .string()
    .max(128)
    .refine((v) => GIT_REF_PATTERN.test(v), 'Nom de branche invalide'),
  /** SSH key for a PRIVATE repository — '' = none. */
  sshKeyId: z.string().trim().max(64),
});

export type UpdateRegistryDto = z.infer<typeof updateRegistrySchema>;

export const importRegistryEntrySchema = z.object({
  registryId: z.string().min(1),
  /** Catalog entry path inside the repository. */
  path: z.string().min(1),
});

export type ImportRegistryEntryDto = z.infer<typeof importRegistryEntrySchema>;

export const updateRecipeSourceSchema = z.object({
  recipeId: z.string().min(1),
});

export type UpdateRecipeSourceDto = z.infer<typeof updateRecipeSourceSchema>;
