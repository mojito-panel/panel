import { betterAuth } from 'better-auth';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { Pool } from 'pg';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

/**
 * Configuration better-auth côté serveur.
 * - Email/mot de passe en V1
 * - Postgres (docker compose dev, via `pg`) — même base que MikroORM
 * - Rôles admin/user via champ additionnel `role` sur User
 * - Cookies TanStack Start (forward des headers)
 *
 * Comme custodia : baseURL via BETTER_AUTH_URL, pas de trustedOrigins.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  database: new Pool({ connectionString: databaseUrl }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'user',
        required: false,
        input: false, // non modifiable par le client à l'inscription
      },
    },
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
    updateAge: 60 * 60 * 24, // refresh toutes les 24h
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      userId: 'user_id',
      userAgent: 'user_agent',
      ipAddress: 'ip_address',
    },
  },
  account: {
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshToken: 'refresh_token',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      idToken: 'id_token',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  plugins: [tanstackStartCookies()],
  advanced: {
    cookiePrefix: 'mojito',
  },
});

export type Auth = typeof auth;
