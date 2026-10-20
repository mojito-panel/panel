import { z } from 'zod';
import { validateVariableValue, type RecipeVariable } from '~/contract';
import { subuserPermissionsSchema } from '~/lib/permissions';

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
  /** CPU limit in cores — floats allowed (1.5), 0 = unlimited. */
  cpuCores: z
    .number()
    .min(0, 'Le CPU doit être >= 0 cœurs (0 = illimité)')
    .max(1024, 'Le CPU doit être <= 1024 cœurs'),
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

/**
 * Server detail — the id alone (getServerFn / getServerRuntimeFn).
 */
export const serverDetailQuerySchema = z.object({
  serverId: z.string().min(1),
});

export type ServerDetailQueryDto = z.infer<typeof serverDetailQuerySchema>;

/**
 * Incremental logs cursor (console polling) — `after` is the last line
 * index seen by the client.
 */
export const serverLogsQuerySchema = z.object({
  serverId: z.string().min(1),
  after: z.coerce.number().int().min(0).default(0),
});

/**
 * Server deletion — `force` is the dead-node escape hatch: the agent
 * cleanup is skipped when the agent is unreachable, the leftover install
 * is reconciled once the node answers again.
 */
export const deleteServerSchema = z.object({
  serverId: z.string().min(1),
  force: z.boolean().optional(),
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

// ─── Sub-users (per-server permission grants, Pelican "Users" tab) ──────────

/** Adds a sub-user by email with a permission grant. */
export const addServerUserSchema = z.object({
  serverId: z.string().min(1),
  email: z.string().email('Email invalide'),
  permissions: subuserPermissionsSchema,
});

export type AddServerUserDto = z.infer<typeof addServerUserSchema>;

/** Updates a sub-user's permission grant. */
export const updateServerUserSchema = z.object({
  serverId: z.string().min(1),
  userId: z.string().min(1),
  permissions: subuserPermissionsSchema,
});

export type UpdateServerUserDto = z.infer<typeof updateServerUserSchema>;

/** Removes a sub-user from a server. */
export const removeServerUserSchema = z.object({
  serverId: z.string().min(1),
  userId: z.string().min(1),
});

export type RemoveServerUserDto = z.infer<typeof removeServerUserSchema>;

// ─── Backups (server archives, Pelican "Backups" tab) ───────────────────────

/** Creates a backup — the name is optional (default: dated label). */
export const createBackupSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().trim().max(128).optional(),
});

export type CreateBackupDto = z.infer<typeof createBackupSchema>;

/** Form schema of the "create a backup" card (TanStack Form + Zod). */
export const createBackupFormSchema = z.object({
  name: z.string().max(128, 'Le nom doit faire au plus 128 caractères'),
});

export type CreateBackupFormDto = z.infer<typeof createBackupFormSchema>;

/** Restores a backup onto the server (truncate = wipe first, destructive). */
export const restoreBackupSchema = z.object({
  serverId: z.string().min(1),
  backupId: z.string().min(1),
  truncate: z.boolean(),
});

export type RestoreBackupDto = z.infer<typeof restoreBackupSchema>;

/** Deletes a backup (agent archive + panel row). */
export const deleteBackupSchema = z.object({
  serverId: z.string().min(1),
  backupId: z.string().min(1),
});

export type DeleteBackupDto = z.infer<typeof deleteBackupSchema>;

/** Requests a signed download link for a completed backup. */
export const backupDownloadSchema = z.object({
  serverId: z.string().min(1),
  backupId: z.string().min(1),
});

export type BackupDownloadDto = z.infer<typeof backupDownloadSchema>;
