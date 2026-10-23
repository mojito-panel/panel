import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import { ormConfig } from '../src/db/index';
import { Recipe, Server } from '~/db/entities';
import { buildRecipeSnapshot } from '../src/server/recipe-snapshot';
import { mergeVariableValues } from '../src/lib/recipe-merge';

/**
 * Reproduction of the reported corruption: "reload recipe" from the
 * server settings destroys the recipe row's `requires` (the admin
 * recipe editor shows the runtime graph empty afterwards).
 *
 * The reload sequence is reproduced verbatim (buildRecipeSnapshot →
 * assign server.recipeSnapshot/runtimeSnapshots → mergeVariableValues →
 * flush), then the recipe rows are reloaded FRESH and their `requires`
 * checked.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://mojito:mojito@localhost:5432/mojito';

async function databaseReachable(): Promise<boolean> {
  try {
    const probe = await MikroORM.init({ ...ormConfig, clientUrl: DATABASE_URL, connect: false });
    await probe.connect();
    await probe.close(true);
    return true;
  } catch {
    return false;
  }
}

const databaseUp = await databaseReachable();

describe.skipIf(!databaseUp)('reload recipe must not corrupt the recipe row', () => {
  let orm: MikroORM;
  const SUFFIX = `repro${Date.now()}`;
  const appSlug = `mc-${SUFFIX}`;
  const runtimeSlug = `java-${SUFFIX}`;

  const runtimeJson = {
    schema_version: 4,
    type: 'runtime',
    id: runtimeSlug,
    name: 'Java (repro)',
    author: 'test',
    requires: [],
    variables: [
      {
        env: 'JAVA_VERSION',
        name: 'Version Java',
        description: '',
        type: 'string',
        default_value: '25',
        user_viewable: false,
        user_editable: false,
        sort: 0,
        required: false,
        options: ['21', '25'],
      },
    ],
    install: [],
    export: { path: 'bin', env: { JAVA_HOME: '{{RUNTIME_DIR}}' } },
  };

  const appJson = {
    schema_version: 4,
    id: appSlug,
    name: 'Minecraft (repro)',
    author: 'test',
    requires: [runtimeSlug],
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
    orm = await MikroORM.init({ ...ormConfig, clientUrl: DATABASE_URL, allowGlobalContext: true });
    await orm.migrator.up();
    const em = orm.em.fork();
    const now = new Date();
    em.persist([
      em.create(Recipe, { id: `rt-${SUFFIX}`, slug: runtimeSlug, name: runtimeJson.name, schemaVersion: 4, json: runtimeJson, createdAt: now, updatedAt: now }),
      em.create(Recipe, { id: `app-${SUFFIX}`, slug: appSlug, name: appJson.name, schemaVersion: 4, json: appJson, createdAt: now, updatedAt: now }),
    ]);
    await em.flush();
  });

  afterAll(async () => {
    const em = orm.em.fork();
    await em.nativeDelete(Recipe, { slug: { $in: [appSlug, runtimeSlug] } });
    await em.nativeDelete(Server, { name: `srv-${SUFFIX}` });
    await orm.close(true);
  });

  it('keeps requires on the app recipe row after the reload sequence', async () => {
    const em = orm.em.fork();
    const recipe = await em.findOneOrFail(Recipe, { slug: appSlug });
    expect((recipe.json as { requires?: string[] }).requires).toEqual([runtimeSlug]);

    const server = em.create(Server, {
      id: `srv-${SUFFIX}`,
      name: `srv-${SUFFIX}`,
      nodeId: 'none',
      recipeId: recipe.id,
      ownerId: 'none',
      status: 'installed',
      memoryMb: 1024,
      cpuCores: 2,
      variables: {},
      recipeSnapshot: {} as Record<string, unknown>,
      runtimeSnapshots: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await em.flush();

    // ── The reload sequence, verbatim (refreshServerRecipeSnapshot) ──
    const snapshot = await buildRecipeSnapshot(em, recipe.json as Record<string, unknown>);
    server.recipeSnapshot = snapshot.recipe as unknown as Record<string, unknown>;
    server.runtimeSnapshots = snapshot.runtimes;
    server.recipeSyncedAt = new Date();
    server.variables = mergeVariableValues(snapshot.recipe.variables ?? [], server.variables);
    await em.flush();

    // ── Fresh load of BOTH recipe rows — did anything leak into them? ──
    const em2 = orm.em.fork();
    const appRow = await em2.findOneOrFail(Recipe, { slug: appSlug });
    const runtimeRow = await em2.findOneOrFail(Recipe, { slug: runtimeSlug });
    expect((appRow.json as { requires?: string[] }).requires, 'app recipe row lost its requires').toEqual([runtimeSlug]);
    expect((runtimeRow.json as { path?: string }).export, 'runtime row lost its export').toMatchObject({ path: 'bin' });
    expect((runtimeRow.json as { env?: string }).variables).toHaveLength(1);
  });
});
