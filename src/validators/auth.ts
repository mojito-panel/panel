import { z } from 'zod';

/**
 * Username — also the SFTP login (`{username}.{serverId}`): no dots, so the
 * SFTP username split at the last dot stays unambiguous. Stored lowercased.
 */
export const usernameSchema = z
  .string()
  .min(3, 'Le nom d’utilisateur doit faire au moins 3 caractères')
  .max(32, 'Le nom d’utilisateur doit faire au plus 32 caractères')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Lettres, chiffres, tirets et underscores uniquement');

export const loginSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

export type LoginDto = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().min(2, 'Le nom doit faire au moins 2 caractères'),
  username: usernameSchema,
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
});

export type RegisterDto = z.infer<typeof registerSchema>;
