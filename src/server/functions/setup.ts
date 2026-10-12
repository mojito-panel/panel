import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { hashPassword } from 'better-auth/crypto';
import { initOrm } from '~/db';
import { Account, User } from '~/db/entities';
import { nanoid } from '~/lib/nanoid';
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
export const getSetupStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ needsSetup: boolean }> => {
    const orm = await initOrm();
    const em = orm.em.fork();
    const count = await em.count(User, {});
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
  .handler(async ({ data }) => {
    const orm = await initOrm();
    const em = orm.em.fork();

    // One-time gate: refuse as soon as any account exists.
    const count = await em.count(User, {});
    if (count > 0) {
      throw new HttpError(403, 'La configuration initiale est déjà terminée');
    }

    // Same creation pattern as createUserFn (server/functions/users.ts):
    // direct MikroORM, scrypt password via better-auth/crypto. The
    // credential account's accountId is the USER ID — better-auth's
    // sign-in matches on accountId === user.id (same as its own sign-up).
    const email = data.email.toLowerCase();
    const username = data.username.toLowerCase();
    const password = await hashPassword(data.password);
    const now = new Date();
    const user = em.create(User, {
      id: nanoid(),
      name: data.name,
      username,
      email,
      emailVerified: true,
      role: 'admin',
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    });
    em.persist(user);
    em.persist(
      em.create(Account, {
        id: nanoid(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await em.flush();

    return { id: user.id, email: user.email, role: user.role };
  });
