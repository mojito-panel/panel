import { z } from 'zod';
import { validateVariableValue, type PluginVariable } from '@mojito/contract';

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

/**
 * Variable update — built dynamically from the plugin's variable definitions
 * so the form gets per-variable validation (type, min/max, pattern, options,
 * required) reusing the contract's own rules. Non-editable variables are
 * forced back to their current value by the server function.
 */
export function makeUpdateServerVariablesSchema(pluginVariables: PluginVariable[]) {
  const valueSchema = z.union([z.string(), z.number(), z.boolean()]);

  return z.object({
    serverId: z.string().min(1),
    // NOTE: addIssue paths are RELATIVE to the record (Zod prepends the
    // record's own key), so [env] → ['variables', env] in the final issue —
    // exactly what TanStack Form needs to map the error onto the
    // `variables.ENV` field.
    variables: z.record(z.string(), valueSchema).superRefine((record, ctx) => {
      for (const variable of pluginVariables) {
        const value = record[variable.env];
        // The full record is sent back — a missing key means the field was
        // emptied out: only required variables are rejected
        if (value === undefined || value === '') {
          if (variable.required) {
            ctx.addIssue({
              code: 'custom',
              path: [variable.env],
              message: `${variable.name} est requis`,
            });
          }
          continue;
        }
        const error = validateVariableValue(variable, value);
        if (error) {
          ctx.addIssue({
            code: 'custom',
            path: [variable.env],
            message: error,
          });
        }
      }
    }),
  });
}

/** Wire format for the update server function (semantic rules are checked in the handler). */
export const updateServerVariablesSchema = z.object({
  serverId: z.string().min(1),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type UpdateServerVariablesDto = z.infer<typeof updateServerVariablesSchema>;
