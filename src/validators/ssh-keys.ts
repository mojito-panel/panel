import { z } from 'zod';

/**
 * Zod schemas for the SSH keys server functions (the /admin/keys page and
 * the private-repository picker of the marketplace registries).
 */

/** Shared identity fields of a key (create, both modes). */
const nameSchema = z
  .string()
  .trim()
  .min(2, 'Le nom doit faire au moins 2 caractères')
  .max(128);

/**
 * Key creation — one form, two modes:
 * - generate: a new Ed25519 pair is produced by the system `ssh-keygen`
 *   (the private key never leaves the panel; the public key is shown once
 *   to be authorized on the forge);
 * - import: an existing private key (textarea) + optional public key —
 *   derived with `ssh-keygen -y` when absent, and CROSS-CHECKED when given.
 */
export const createSshKeySchema = z
  .object({
    mode: z.enum(['generate', 'import']),
    name: nameSchema,
    /** Generate only — key comment (e.g. "deploy@panel"), optional. */
    comment: z.string().trim().max(128),
    /** Import only — the private key in OpenSSH or PEM form. */
    privateKey: z.string().max(16_384),
    /** Import only — when absent, derived from the private key. */
    publicKey: z.string().trim().max(4_096),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'import' && value.privateKey.trim().length === 0) {
      ctx.addIssue({ code: 'custom', path: ['privateKey'], message: 'Clé privée requise' });
    }
  });

export type CreateSshKeyDto = z.infer<typeof createSshKeySchema>;

export const sshKeyIdSchema = z.object({
  sshKeyId: z.string().min(1),
});

export type SshKeyIdDto = z.infer<typeof sshKeyIdSchema>;
