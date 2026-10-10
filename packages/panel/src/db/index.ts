import { MikroORM } from '@mikro-orm/sqlite';
import { Migrator } from '@mikro-orm/migrations';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Node, Plugin, Server, ServerAllocation } from './entities';

const dbPath = resolve(process.env.DATABASE_PATH ?? './data/mojito.db');
mkdirSync(dirname(dbPath), { recursive: true });

/**
 * Configuration MikroORM v7 (defineEntity, decorator-less).
 * SQLite — même fichier que better-auth (node:sqlite).
 *
 * Seules les entités métier sont gérées ici : better-auth crée et migre
 * ses propres tables (user/session/account/verification) via
 * `npm run auth:migrate` — on ne sync JAMAIS le schéma des tables auth
 * depuis MikroORM pour éviter tout conflit de définition.
 */
export const ormConfig = {
  dbName: dbPath,
  entities: [Node, Plugin, Server, ServerAllocation],
  extensions: [Migrator],
  debug: process.env.NODE_ENV !== 'production',
};

let orm: MikroORM | null = null;

/**
 * Initialise (ou retourne) l'instance MikroORM singleton.
 * Au premier appel : sync du schéma des entités métier (create/update,
 * non destructif pour better-auth).
 */
export async function initOrm(): Promise<MikroORM> {
  if (!orm) {
    orm = await MikroORM.init(ormConfig);
    await orm.schema.update();
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
