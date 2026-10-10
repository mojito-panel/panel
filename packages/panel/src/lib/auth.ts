import { betterAuth } from 'better-auth';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = resolve(process.env.DATABASE_PATH ?? './data/mojito.db');
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new DatabaseSync(dbPath);
sqlite.exec('PRAGMA journal_mode = WAL');

/**
 * Configuration better-auth côté serveur.
 * - Email/mot de passe en V1
 * - SQLite via node:sqlite (Node 24, même fichier que MikroORM)
 * - Rôles admin/user via champ additionnel `role` sur User
 * - Cookies TanStack Start (forward des headers)
 *
 * Comme custodia : baseURL via BETTER_AUTH_URL, pas de trustedOrigins.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  database: sqlite as never, // node:sqlite DatabaseSync ~ compatible better-sqlite3
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
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
    updateAge: 60 * 60 * 24, // refresh toutes les 24h
  },
  plugins: [tanstackStartCookies()],
  advanced: {
    cookiePrefix: 'mojito',
  },
});

export type Auth = typeof auth;
