import { betterAuth } from 'better-auth';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { Pool } from 'pg';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

/**
 * Server-side better-auth configuration.
 * - Email/password in V1
 * - Postgres (docker compose dev, via `pg`) — same database as MikroORM
 * - admin/user roles via an additional `role` field on User
 * - TanStack Start cookies (header forwarding)
 *
 * Like custodia: baseURL via BETTER_AUTH_URL, no trustedOrigins.
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
        input: false, // not editable by the client at sign-up
      },
    },
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh every 24h
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
