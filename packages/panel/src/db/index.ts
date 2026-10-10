import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { basename, extname } from 'node:path';
import {
  User,
  Session,
  Account,
  Verification,
  Node,
  Plugin,
  Server,
  ServerAllocation,
} from './entities';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

// Migrations bundlées (comme custodia) — le migrator n'a pas besoin de
// résoudre un path sur disque, ça marche en dev comme en build.
const modules = import.meta.glob('../migrations/Migration*');

const migrations = [];
for (const path in modules) {
  const mod: any = await modules[path]();
  const name = basename(path).replace(extname(path), '');
  migrations.push({ name, class: mod.default || mod[name] });
}

/**
 * Configuration MikroORM v7 (defineEntity, decorator-less).
 * Postgres (docker compose dev) — MikroORM gère TOUTES les tables,
 * y compris les tables better-auth (user/session/account/verification,
 * mappées en snake_case côté better-auth via `user.fields` etc.).
 * Les migrations s'exécutent au démarrage du serveur (`src/server.ts`).
 */
export const ormConfig = {
  dbName: 'mojito',
  clientUrl: databaseUrl,
  entities: [User, Session, Account, Verification, Node, Plugin, Server, ServerAllocation],
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
 * Initialise (ou retourne) l'instance MikroORM singleton (connexion Postgres).
 * Le schéma des entités métier est géré par les migrations MikroORM :
 * `src/server.ts` exécute `orm.migrator.up()` au démarrage du serveur.
 * On n'utilise JAMAIS `schema.update()` ici — MikroORM v7 drop par défaut
 * les tables qu'il ne connaît pas, ce qui supprimerait les tables
 * better-auth (user/session/account/verification) et tous les comptes.
 */
export async function initOrm(): Promise<MikroORM> {
  if (!orm) {
    orm = await MikroORM.init(ormConfig);
  }
  return orm;
}

/**
 * Retourne l'instance MikroORM courante (doit être initialisée avant).
 */
export function getOrm(): MikroORM {
  if (!orm) throw new Error('MikroORM not initialized. Call initOrm() first.');
  return orm;
}

export * from './entities';
export * from './types';
