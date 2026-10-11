import { z } from 'zod';
import { rolePermissionsSchema } from '~/lib/permissions';

/** Creates a custom panel role (the id is derived from the name). */
export const createRoleSchema = z.object({
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  description: z.string().max(1024).optional(),
  permissions: rolePermissionsSchema,
});

export type CreateRoleDto = z.infer<typeof createRoleSchema>;

/** Edits a custom role (name, description, permission matrix). */
export const updateRoleSchema = z.object({
  roleId: z.string().min(1),
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  description: z.string().max(1024).optional(),
  permissions: rolePermissionsSchema,
});

export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

/** Deletes a custom role (refused while users still carry it). */
export const deleteRoleSchema = z.object({
  roleId: z.string().min(1),
});
