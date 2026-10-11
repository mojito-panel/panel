import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { basename, extname } from 'node:path';
import {
  User,
  Session,
  Account,
  Verification,
  Node,
  Recipe,
  Server,
  Allocation,
  ServerUser,
  PanelRole,
} from './entities';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

// Bundled migrations (like custodia) — the migrator does not need to
// resolve a path on disk; works in dev as well as in build.
const modules = import.meta.glob('../migrations/Migration*');

const migrations = [];
for (const path in modules) {
  const mod: any = await modules[path]();
  const name = basename(path).replace(extname(path), '');
  migrations.push({ name, class: mod.default || mod[name] });
}

/**
 * MikroORM v7 configuration (defineEntity, decorator-less).
 * Postgres (docker compose dev) — MikroORM manages ALL tables,
 * including the better-auth tables (user/session/account/verification,
 * mapped snake_case on the better-auth side via `user.fields` etc.).
 * Migrations run at server startup (`src/server.ts`).
 */
export const ormConfig = {
  dbName: 'mojito',
  clientUrl: databaseUrl,
  entities: [
    User,
    Session,
    Account,
    Verification,
    Node,
    Recipe,
    Server,
    Allocation,
    ServerUser,
    PanelRole,
  ],
  extensions: [Migrator],
  debug: process.env.NODE_ENV !== 'production',
  migrations: {
    migrationsList: migrations,
    snapshot: false,
    tableName: 'mikro_orm_migrations',
  },
};

let orm: MikroORM | null = null;

/**
 * Initializes (or returns) the singleton MikroORM instance (Postgres connection).
 * The business entity schema is managed by MikroORM migrations:
 * `src/server.ts` runs `orm.migrator.up()` at server startup.
 * NEVER use `schema.update()` here — MikroORM v7 drops by default
 * tables it does not know, which would delete the
 * better-auth tables (user/session/account/verification) and all accounts.
 */
export async function initOrm(): Promise<MikroORM> {
  if (!orm) {
    orm = await MikroORM.init(ormConfig);
  }
  return orm;
}

/**
 * Returns the current MikroORM instance (must be initialized first).
 */
export function getOrm(): MikroORM {
  if (!orm) throw new Error('MikroORM not initialized. Call initOrm() first.');
  return orm;
}

export * from './entities';
export * from './types';
