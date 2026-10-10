import { z } from 'zod';

export const createNodeSchema = z.object({
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  fqdn: z.string().min(3, 'FQDN invalide').max(255),
  agentPort: z.number().int().min(1).max(65535),
});

export type CreateNodeDto = z.infer<typeof createNodeSchema>;

export const deleteNodeSchema = z.object({
  nodeId: z.string().min(1),
});

export const createPluginSchema = z.object({
  /** JSON du plugin — validé par parsePlugin du contract. */
  json: z.string().min(1, 'Le JSON du plugin est requis'),
});

export type CreatePluginDto = z.infer<typeof createPluginSchema>;

export const deletePluginSchema = z.object({
  pluginId: z.string().min(1),
});
