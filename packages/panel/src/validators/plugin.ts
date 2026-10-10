import { z } from 'zod';

/**
 * Schémas Zod des server functions plugins (import/edit/export).
 * Le JSON du plugin lui-même est validé par `parsePlugin` du contract (schéma v2).
 */

export const importPluginsSchema = z
  .object({
    /** JSON bruts (textarea ou contenu de fichiers .json). */
    jsons: z.array(z.string().min(1)).max(10).optional(),
    /** URLs de plugins .json (github.com/blob → raw converti côté serveur). */
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

export const updatePluginSchema = z.object({
  pluginId: z.string().min(1),
  /** JSON du plugin modifié — revalidé intégralement par `parsePlugin`. */
  json: z.string().min(1, 'Le JSON du plugin est requis'),
});

export type UpdatePluginDto = z.infer<typeof updatePluginSchema>;

export const deletePluginSchema = z.object({
  pluginId: z.string().min(1),
});
