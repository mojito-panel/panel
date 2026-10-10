import { z } from 'zod';

/**
 * Zod schemas for the plugin server functions (import/edit/export).
 * The plugin JSON itself is validated by the contract's `parsePlugin` (v2 schema).
 */

export const importPluginsSchema = z
  .object({
    /** Raw JSONs (textarea or .json file contents). */
    jsons: z.array(z.string().min(1)).max(10).optional(),
    /** Plugin .json URLs (github.com/blob → raw converted server-side). */
    urls: z.array(z.string().url()).max(10).optional(),
  })
  .refine((d) => (d.jsons?.length ?? 0) + (d.urls?.length ?? 0) > 0, {
    message: 'Fournir au moins un JSON ou une URL',
    path: ['jsons'],
  });

export type ImportPluginsDto = z.infer<typeof importPluginsSchema>;

export const getPluginSchema = z.object({
  pluginId: z.string().min(1),
});

export type GetPluginDto = z.infer<typeof getPluginSchema>;

export const createPluginSchema = z.object({
  /** New plugin JSON — fully revalidated by `parsePlugin`. */
  json: z.string().min(1, 'Le JSON du plugin est requis'),
});

export type CreatePluginDto = z.infer<typeof createPluginSchema>;

export const updatePluginSchema = z.object({
  pluginId: z.string().min(1),
  /** Modified plugin JSON — fully revalidated by `parsePlugin`. */
  json: z.string().min(1, 'Le JSON du plugin est requis'),
});

export type UpdatePluginDto = z.infer<typeof updatePluginSchema>;

export const deletePluginSchema = z.object({
  pluginId: z.string().min(1),
});
