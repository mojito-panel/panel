import { z } from 'zod';

import { serverNameField } from './server';

/**
 * Admin-area server validators (/admin/servers — Pelican admin Servers
 * equivalent). The per-server pages keep using ~/validators/server.
 */

/** Server id input shared by the detail / action functions. */
export const adminServerIdSchema = z.object({
  serverId: z.string().min(1),
});

export type AdminServerIdDto = z.infer<typeof adminServerIdSchema>;

/**
 * Deletion — `force` is the dead-node escape hatch: the agent cleanup is
 * skipped when the agent is unreachable, the leftover install is
 * reconciled once the node answers again.
 */
export const adminDeleteServerSchema = z.object({
  serverId: z.string().min(1),
  force: z.boolean().optional(),
});

export type AdminDeleteServerDto = z.infer<typeof adminDeleteServerSchema>;

/**
 * Change recipe — the server is re-snapshotted from the target recipe and
 * reinstalled with it (the admin propagation path between recipes).
 */
export const adminChangeServerRecipeSchema = z.object({
  serverId: z.string().min(1),
  recipeId: z.string().min(1),
});

export type AdminChangeServerRecipeDto = z.infer<typeof adminChangeServerRecipeSchema>;

/**
 * Update form (Pelican "information" + "environment configuration" tabs,
 * adapted): identity + owner transfer + resource limits. The wire schema —
 * the form reuses it and adds the serverId at submit time.
 */
export const updateAdminServerFormSchema = z.object({
  name: serverNameField,
  ownerId: z.string().min(1, 'Choisis un propriétaire'),
  /** RAM limit in MB — 0 = unlimited (no Job Object commit cap). */
  memoryMb: z
    .number()
    .int()
    .min(0, 'La RAM doit être >= 0 Mo (0 = illimité)')
    .max(65536, 'La RAM doit être <= 65536 Mo'),
  /** CPU limit in cores — floats allowed (1.5), 0 = unlimited. */
  cpuCores: z
    .number()
    .min(0, 'Le CPU doit être >= 0 cœurs (0 = illimité)')
    .max(1024, 'Le CPU doit être <= 1024 cœurs'),
  backupLimit: z
    .number()
    .int()
    .min(0, 'La limite doit être >= 0 (0 = sauvegardes désactivées)')
    .max(100, 'La limite doit être <= 100'),
});

export type UpdateAdminServerFormDto = z.infer<typeof updateAdminServerFormSchema>;

/** Wire format of the update function (form values + the target server). */
export const updateAdminServerSchema = updateAdminServerFormSchema.extend({
  serverId: z.string().min(1),
});

export type UpdateAdminServerDto = z.infer<typeof updateAdminServerSchema>;

/** Suspend/unsuspend toggle (Pelican Suspend/Unsuspend actions). */
export const setAdminServerSuspendedSchema = z.object({
  serverId: z.string().min(1),
  suspended: z.boolean(),
});

export type SetAdminServerSuspendedDto = z.infer<typeof setAdminServerSuspendedSchema>;

/**
 * Allocation action on the admin server record (Pelican
 * AllocationsRelationManager): claim a free allocation of the server's
 * node, release a non-primary one, or change the primary.
 */
export const adminServerAllocationActionSchema = z.object({
  serverId: z.string().min(1),
  allocationId: z.string().min(1),
});

export type AdminServerAllocationActionDto = z.infer<typeof adminServerAllocationActionSchema>;
