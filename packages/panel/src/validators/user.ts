import { z } from 'zod';

/**
 * Admin "create user" form (name, email, password, role). The role value is
 * a built-in name ('admin'/'moderator'/'user') or a custom role id from
 * the `role` table — the picker is fed by listRolesFn.
 */
export const createUserFormSchema = z.object({
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
  role: z.string().min(1, 'Choisis un rôle'),
});

export type CreateUserFormDto = z.infer<typeof createUserFormSchema>;
