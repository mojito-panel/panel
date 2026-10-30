import { MikroORM } from '@mikro-orm/postgresql';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { Recipe, Server } from '~/db/entities';
import type { IServer } from '~/db/types';

import { ormConfig } from '../src/db/index';
import { databaseReachable } from './helpers/db-reachable';
import { metadataOnly } from './helpers/metadata-orm';

/**
 * The recipe snapshot merge against the REAL dev database — the exact
 * scenario of a pre-snapshot Minecraft server: the app recipe requires a
 * runtime whose variables are user_viewable:false, and the server's
 * variables page must still receive them as user-editable knobs.
 *
 * Applies the panel migrations itself (the dev stack is usually started
 * by the panel boot, not the CLI) and SKIPS when no database is
 * reachable — `npm test` stays green without the dev stack.
 *
 * The service modules (../src/server/recipe-snapshot, which resolves the
 * request EM through the global ORM singleton) are imported DYNAMICALLY
 * inside beforeAll: their module graph initializes a Postgres connection,
 * which must only happen once the probe has passed.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

const databaseUp = await databaseReachable(DATABASE_URL);

describe.skipIf(!databaseUp)('recipe snapshot against Postgres', () => {
  let orm: MikroORM;
  let seededServer: IServer;
  /** Service imports — dynamic (see the module docblock). */
  let serverRecipeSnapshot: typeof import('../src/server/recipe-snapshot').serverRecipeSnapshot;
  let runWithOrmContext: typeof import('../src/server/orm').runWithOrmContext;

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
    ({ serverRecipeSnapshot } = await import('../src/server/recipe-snapshot'));
    ({ runWithOrmContext } = await import('../src/server/orm'));

    orm = await MikroORM.init({ ...ormConfig, clientUrl: DATABASE_URL, ...metadataOnly });
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

    // The service resolves its EM through the panel's global ORM singleton
    // (no em parameter) — run it inside one request context like the panel does.
    const snapshot = await runWithOrmContext(() =>
      serverRecipeSnapshot(server as unknown as IServer),
    );

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

    // The backfill persisted the ONE-document snapshot on the row.
    expect(server.recipeSnapshot).toMatchObject({
      recipe: { id: 'minecraft-snaptest' },
      runtimes: [{ id: 'java-snaptest' }],
    });
    expect(server.recipeSyncedAt).toBeDefined();
  });
});
