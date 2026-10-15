import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import { User } from '~/db/entities';
import { auth } from '~/lib/auth';
import { usernameSchema } from '~/validators/auth';
import { HttpError } from '../session';

/**
 * First-run setup — while the `user` table is empty, the panel is locked
 * on /setup (see __root.tsx beforeLoad) and the first account created here
 * gets the built-in `admin` role. Once any account exists, the creation
 * endpoint refuses (403) and /setup redirects back to /.
 */

// ─── Status ──────────────────────────────────────────────────────────────────

/** True while no account exists — fetched in __root.tsx's beforeLoad (SSR). */
export const getSetupStatusFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(
  async (): Promise<{ needsSetup: boolean }> => {
    const count = await orm.em.count(User, {});
    return { needsSetup: count === 0 };
  },
);

// ─── First admin creation ────────────────────────────────────────────────────

export const createFirstAdminFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
      username: usernameSchema,
      email: z.string().email('Email invalide'),
      password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
    }),
  )
  .middleware([withOrmContext])
  .handler(async ({ data }) => {

    // One-time gate: refuse as soon as any account exists.
    const count = await orm.em.count(User, {});
    if (count > 0) {
      throw new HttpError(403, 'La configuration initiale est déjà terminée');
    }

    // better-auth's own registration builds the user + credential account
    // (id generation, scrypt hash, accountId === user.id — see
    // docs/concepts/users-accounts). The registration-gate hook only runs
    // on HTTP sign-up calls, so the first-run setup can never be blocked.
    const { user } = await auth.api.signUpEmail({
      body: { name: data.name, email: data.email, password: data.password },
    });

    // Panel-specific fields better-auth's user model doesn't carry: the
    // admin role for the first account, the SFTP username, a verified
    // email (there is nobody to verify it with at first run).
    const row = await orm.em.findOne(User, { id: user.id });
    if (!row) {
      throw new HttpError(500, 'La création du compte administrateur a échoué');
    }
    row.role = 'admin';
    row.username = data.username.toLowerCase();
    row.emailVerified = true;
    await orm.em.flush();

    return { id: row.id, email: row.email, role: row.role };
  });
