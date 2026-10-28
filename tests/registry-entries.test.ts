import { describe, expect, it } from 'vitest';
import { parseRecipe } from '~/contract';
import { buildRegistryEntries, canonicalRecipeHash } from '../src/server/registry-entries';

/** Minimal valid app recipe (schema v4) — the contract defaults the rest. */
const APP_RECIPE = {
  schema_version: 4,
  id: 'test-game',
  name: 'Test Game',
  author: 'Tester',
  start: { command: 'run.exe' },
};

/** Minimal valid runtime recipe. */
const RUNTIME_RECIPE = {
  schema_version: 4,
  type: 'runtime',
  id: 'jdk',
  name: 'JDK',
  author: 'Tester',
};

/** The same app recipe, reformatted + reordered — content-identical. */
const APP_RECIPE_REFORMATTED = `{
  "start": { "command": "run.exe" },
  "author": "Tester",
  "name": "Test Game",
  "id": "test-game",
  "schema_version": 4
}`;

describe('canonicalRecipeHash', () => {
  it('is invariant to formatting and key order', () => {
    const a = canonicalRecipeHash(parseRecipe(APP_RECIPE));
    const b = canonicalRecipeHash(parseRecipe(JSON.parse(APP_RECIPE_REFORMATTED)));
    expect(a).toBe(b);
  });

  it('changes when the content changes', () => {
    const a = canonicalRecipeHash(parseRecipe(APP_RECIPE));
    const b = canonicalRecipeHash(parseRecipe({ ...APP_RECIPE, name: 'Renamed' }));
    expect(a).not.toBe(b);
  });
});

describe('buildRegistryEntries', () => {
  it('extracts metadata and hashes valid recipes', () => {
    const entries = buildRegistryEntries([
      { path: 'steamcmd/test-game/recipe-test-game.json', content: JSON.stringify(APP_RECIPE) },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: 'steamcmd/test-game/recipe-test-game.json',
      slug: 'test-game',
      name: 'Test Game',
      type: null,
      error: null,
    });
    // The stored hash matches the hash of the parsed recipe — statuses compare
    // entry.sha against the recipe's source stamp, both canonical.
    expect(entries[0].sha).toBe(canonicalRecipeHash(parseRecipe(APP_RECIPE)));
  });

  it('badges runtime recipes', () => {
    const entries = buildRegistryEntries([
      { path: 'runtimes/jdk/recipe-jdk.json', content: JSON.stringify(RUNTIME_RECIPE) },
    ]);
    expect(entries[0].slug).toBe('jdk');
    expect(entries[0].type).toBe('runtime');
  });

  it('keeps invalid files in the catalog with their error', () => {
    const entries = buildRegistryEntries([
      { path: 'steamcmd/bad/recipe-bad.json', content: '{ not json' },
      {
        path: 'steamcmd/invalid/recipe-invalid.json',
        content: JSON.stringify({ schema_version: 3, id: 'old' }),
      },
    ]);

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.slug).toBeNull();
      expect(entry.name).toBeNull();
      expect(entry.error).toBeTruthy();
    }
  });

  it('only matches the recipe-*.json naming convention (anchored)', () => {
    const entries = buildRegistryEntries([
      { path: 'steamcmd/x/recipe-x.json', content: JSON.stringify(APP_RECIPE) },
      { path: 'steamcmd/x/README.md', content: 'not a recipe' },
      { path: 'steamcmd/x/myrecipe-x.json', content: JSON.stringify(APP_RECIPE) },
      { path: 'nested/deep/dir/recipe-deep.json', content: JSON.stringify(APP_RECIPE) },
    ]);

    expect(entries.map((entry) => entry.path)).toEqual([
      'nested/deep/dir/recipe-deep.json',
      'steamcmd/x/recipe-x.json',
    ]);
  });

  it('sorts entries by path (the catalog reads grouped by category)', () => {
    const entries = buildRegistryEntries([
      { path: 'z/z/recipe-z.json', content: JSON.stringify(APP_RECIPE) },
      { path: 'a/a/recipe-a.json', content: JSON.stringify(APP_RECIPE) },
    ]);
    expect(entries.map((entry) => entry.path)).toEqual([
      'a/a/recipe-a.json',
      'z/z/recipe-z.json',
    ]);
  });

  it('carries the recipe cover through (base64 data URL from the sync)', () => {
    const cover = 'data:image/png;base64,aGVsbG8=';
    const entries = buildRegistryEntries([
      { path: 'a/a/recipe-a.json', content: JSON.stringify(APP_RECIPE), cover },
      { path: 'b/b/recipe-b.json', content: JSON.stringify(APP_RECIPE) },
    ]);
    expect(entries[0].cover).toBe(cover);
    expect(entries[1].cover).toBeNull();
  });
});
