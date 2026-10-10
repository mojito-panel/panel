import { z } from 'zod';

export const createServerSchema = z.object({
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  nodeId: z.string().min(1, 'Choisis un node'),
  pluginId: z.string().min(1, 'Choisis un plugin'),
  port: z
    .number()
    .int()
    .min(1024, 'Le port doit être >= 1024')
    .max(65535),
  memoryMb: z
    .number()
    .int()
    .min(512, 'La RAM doit être >= 512 Mo')
    .max(65536, 'La RAM doit être <= 65536 Mo'),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type CreateServerDto = z.infer<typeof createServerSchema>;

export const serverActionInputSchema = z.object({
  serverId: z.string().min(1),
  action: z.enum(['start', 'stop', 'restart', 'kill']),
});

export type ServerActionDto = z.infer<typeof serverActionInputSchema>;

export const sendCommandSchema = z.object({
  serverId: z.string().min(1),
  command: z.string().min(1, 'La commande est vide'),
});

export const serverLogsQuerySchema = z.object({
  serverId: z.string().min(1),
  after: z.coerce.number().int().min(0).default(0),
});
