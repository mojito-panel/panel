import { MikroORM } from '@mikro-orm/sqlite';
import { Migrator } from '@mikro-orm/migrations';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  User,
  Session,
  Account,
  Verification,
  Node,
  Plugin,
  Server,
  ServerAllocation,
} from './entities.ts';

const dbPath = resolve(process.env.DATABASE_PATH ?? './data/mojito.db');
mkdirSync(dirname(dbPath), { recursive: true });

/**
 * Configuration MikroORM v7 (defineEntity, decorator-less).
 * SQLite — même fichier que better-auth (node:sqlite).
 * Note : better-auth gère ses propres migrations (tables user/session/account/verification)
 * via `npm run auth:migrate`. MikroORM gère les entités métier.
 */
export const ormConfig = {
  dbName: dbPath,
  entities: [User, Session, Account, Verification, Node, Plugin, Server, ServerAllocation],
  extensions: [Migrator],
  debug: process.env.NODE_ENV !== 'production',
} as const;

let orm: MikroORM | null = null;

/**
 * Initialise (ou retourne) l'instance MikroORM singleton.
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

export * from './entities.ts';
export * from './types.ts';
