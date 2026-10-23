import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import { ormConfig } from '../src/db/index';
import { Recipe, Server } from '~/db/entities';
import type { IServer } from '~/db/types';
import { serverRecipeSnapshot } from '../src/server/recipe-snapshot';

/**
 * The recipe snapshot merge against the REAL dev database — the exact
 * scenario of a pre-snapshot Minecraft server: the app recipe requires a
 * runtime whose variables are user_viewable:false, and the server's
 * variables page must still receive them as user-editable knobs.
 *
 * Applies the panel migrations itself (the dev stack is usually started
 * by the panel boot, not the CLI) and SKIPS when no database is
 * reachable — `npm test` stays green without the dev stack.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

async function databaseReachable(): Promise<boolean> {
  try {
    const orm = await MikroORM.init({ ...ormConfig, clientUrl: DATABASE_URL, connect: false });
    await orm.connect();
    await orm.close(true);
    return true;
  } catch (error) {
    console.error('database probe failed:', error);
    return false;
  }
}

const databaseUp = await databaseReachable();

describe.skipIf(!databaseUp)('recipe snapshot against Postgres', () => {
  let orm: MikroORM;
  let seededServer: IServer;

  const javaJson = {
    schema_version: 4,
    type: 'runtime',
    id: 'java-snaptest',
    name: 'Java (test)',
    author: 'test',
    variables: [
      {
        env: 'JAVA_VERSION',
        name: 'Version Java (JRE embarqué)',
        description: '',
        type: 'string',
        default_value: '25',
        user_viewable: false,
        user_editable: false,
        sort: 0,
        required: false,
        options: ['11', '17', '21', '25'],
      },
    ],
    install: [],
    export: { path: true, env: { JAVA_HOME: '{{RUNTIME_DIR}}' } },
  };

  const minecraftJson = {
    schema_version: 4,
    id: 'minecraft-snaptest',
    name: 'Minecraft (test)',
    author: 'test',
    requires: ['java-snaptest'],
    variables: [
      {
        env: 'MINECRAFT_VERSION',
        name: 'Version',
        description: '',
        type: 'string',
        default_value: 'latest',
        user_viewable: true,
        user_editable: true,
        sort: 1,
        required: false,
      },
    ],
    install: [],
    start: { command: 'java -jar server.jar', stop: { type: 'command', value: 'stop' } },
  };

  beforeAll(async () => {
    orm = await MikroORM.init({ ...ormConfig, clientUrl: DATABASE_URL });
    await orm.migrator.up();
    const em = orm.em.fork();

    const java = em.create(Recipe, {
      id: 'recipe-java-snaptest',
      slug: 'java-snaptest',
      name: 'Java (test)',
      json: javaJson as unknown as Record<string, unknown>,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const minecraft = em.create(Recipe, {
      id: 'recipe-mc-snaptest',
      slug: 'minecraft-snaptest',
      name: 'Minecraft (test)',
      json: minecraftJson as unknown as Record<string, unknown>,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist([java, minecraft]);

    // A PRE-snapshot server: no snapshot columns, app variables only.
    seededServer = em.create(Server, {
      id: 'server-snaptest',
      name: 'snaptest',
      nodeId: 'node-snaptest',
      recipeId: 'recipe-mc-snaptest',
      ownerId: 'user-snaptest',
      status: 'stopped',
      variables: { MINECRAFT_VERSION: 'latest' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as unknown as IServer;
    em.persist(seededServer);
    await em.flush();
  });

  afterAll(async () => {
    const em = orm.em.fork();
    await em.nativeDelete(Server, { id: 'server-snaptest' });
    await em.nativeDelete(Recipe, { id: 'recipe-mc-snaptest' });
    await em.nativeDelete(Recipe, { id: 'recipe-java-snaptest' });
    await em.flush();
    await orm.close(true);
  });

  it('backfills a pre-snapshot server with the merged definitions (JAVA_VERSION editable)', async () => {
    const em = orm.em.fork();
    const server = await em.findOne(Server, { id: 'server-snaptest' });
    if (!server) throw new Error('seeded server missing');

    const snapshot = await serverRecipeSnapshot(em, server as unknown as IServer);

    const envs = (snapshot.recipe.variables ?? []).map((v) => v.env);
    expect(envs).toContain('MINECRAFT_VERSION');
    expect(envs).toContain('JAVA_VERSION');

    const java = (snapshot.recipe.variables ?? []).find((v) => v.env === 'JAVA_VERSION');
    expect(java).toBeDefined();
    // The runtime declares it hidden/non-editable — on the server it
    // becomes a user-editable knob.
    expect(java?.user_viewable).toBe(true);
    expect(java?.user_editable).toBe(true);
    expect(java?.default_value).toBe('25');

    // The runtime recipes ride along in the snapshot.
    expect(snapshot.runtimes).toHaveLength(1);
    expect((snapshot.runtimes[0] as { id?: string }).id).toBe('java-snaptest');

    // The backfill persisted the snapshot on the row.
    expect(server.recipeSnapshot).toBeDefined();
    expect(server.runtimeSnapshots).toHaveLength(1);
    expect(server.recipeSyncedAt).toBeDefined();
  });
});
