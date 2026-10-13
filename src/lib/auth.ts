import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { Pool } from 'pg';
import { APIError } from 'better-auth/api';
import { initOrm } from '~/db';
import { isRegistrationEnabled } from '../server/settings';
import { ac, PANEL_ROLES } from '~/lib/permissions';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

/**
 * Server-side better-auth configuration.
 * - Email/password in V1
 * - Postgres (docker compose dev, via `pg`) — same database as MikroORM
 * - Pelican-style roles/permissions via the admin plugin + custom access
 *   control (see `~/lib/permissions`): panel permissions attach to the
 *   user's `role`, per-server permissions live in the `server_user` table.
 * - TanStack Start cookies (header forwarding)
 *
 * The admin plugin tables (`banned`/`ban_*`, `impersonated_by`) are managed
 * by MikroORM like every other table — better-auth NEVER generates the
 * migration here.
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
    // NOTE: the `role`/`banned`/`banReason`/`banExpires` fields come from the
    // admin plugin — their snake_case mapping lives in the plugin's own
    // `schema` option below (the top-level `fields` map only applies to
    // CORE fields like emailVerified).
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
  plugins: [
    tanstackStartCookies(),
    admin({
      // Custom Pelican-style statements/roles (~/lib/permissions) — the
      // plugin checks its endpoints against these roles, so a moderator
      // only gets what moderatorRole grants.
      ac,
      roles: { ...PANEL_ROLES },
      adminRoles: ['admin'],
      defaultBanReason: 'Compte suspendu par un administrateur',
      // Snake_case mapping of the PLUGIN fields (mergeSchema applies these
      // as `fieldName`) — the MikroORM migration + entities use the same
      // names, so better-auth and MikroORM stay in sync.
      schema: {
        user: {
          fields: {
            banReason: 'ban_reason',
            banExpires: 'ban_expires',
          },
        },
        session: {
          fields: {
            impersonatedBy: 'impersonated_by',
          },
        },
      },
    }),
  ],
  hooks: {
    // Pelican "registration_enabled" equivalent: the /register toggle is
    // enforced at the better-auth layer, not just hidden in the UI. Only the
    // sign-up endpoints are gated — admin user creation is direct MikroORM
    // (server/functions/users.ts) and /setup is the first-run route.
    before: async (ctx) => {
      // The sign-up endpoints are gated via the request path (the dispatch
      // context also carries `path`, but the static type only knows `request`).
      if (!ctx.request || !new URL(ctx.request.url).pathname.includes('/sign-up')) return;
      const orm = await initOrm();
      if (!(await isRegistrationEnabled(orm.em.fork()))) {
        throw new APIError('FORBIDDEN', {
          message: 'Les inscriptions sont désactivées par un administrateur',
        });
      }
    },
  },
  advanced: {
    cookiePrefix: 'mojito',
  },
});

export type Auth = typeof auth;
