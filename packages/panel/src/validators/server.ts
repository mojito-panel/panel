import { z } from 'zod';
import { validateVariableValue, type RecipeVariable } from '@mojito/contract';

export const createServerSchema = z.object({
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  nodeId: z.string().min(1, 'Choisis un node'),
  recipeId: z.string().min(1, 'Choisis une recette'),
  /** Free allocation claimed from the node's pool (Pelican semantics). */
  allocationId: z.string().min(1, 'Choisis une allocation'),
  memoryMb: z
    .number()
    .int()
    .min(512, 'La RAM doit être >= 512 Mo')
    .max(65536, 'La RAM doit être <= 65536 Mo'),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type CreateServerDto = z.infer<typeof createServerSchema>;

/**
 * Allocation action on the server's Network page: claim a free allocation
 * from the node pool, release a non-primary one, or set the primary.
 */
export const serverAllocationActionSchema = z.object({
  serverId: z.string().min(1),
  allocationId: z.string().min(1),
});

export type ServerAllocationActionDto = z.infer<typeof serverAllocationActionSchema>;

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
 * Variable update — built dynamically from the recipe's variable definitions
 * so the form gets per-variable validation (type, min/max, pattern, options,
 * required) reusing the contract's own rules. Non-editable variables are
 * forced back to their current value by the server function.
 */
export function makeUpdateServerVariablesSchema(recipeVariables: RecipeVariable[]) {
  const valueSchema = z.union([z.string(), z.number(), z.boolean()]);

  return z.object({
    serverId: z.string().min(1),
    // NOTE: addIssue paths are RELATIVE to the record (Zod prepends the
    // record's own key), so [env] → ['variables', env] in the final issue —
    // exactly what TanStack Form needs to map the error onto the
    // `variables.ENV` field.
    variables: z.record(z.string(), valueSchema).superRefine((record, ctx) => {
      for (const variable of recipeVariables) {
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
