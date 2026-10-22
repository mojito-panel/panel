import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRecipe,
  parseRuntimeRecipe,
  isRuntimeRecipeJson,
  type Recipe,
  type RuntimeRecipe,
} from '../src/contract/recipe-schema';

/** Every recipe JSON of the mojito/recipes tree, as [relPath, rawJson]. */
function recipeFiles(dir: string, acc: Array<[string, unknown]> = []): Array<[string, unknown]> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      recipeFiles(path, acc);
    } else if (entry.name.endsWith('.json')) {
      acc.push([path, JSON.parse(readFileSync(path, 'utf8'))]);
    }
  }
  return acc;
}

const FILES = recipeFiles(join(import.meta.dirname, '..', '..', 'recipes'));

describe('recipes tree', () => {
  it('has files', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5);
  });

  it('validates every runtime recipe against the runtime schema', () => {
    const runtimes = FILES.filter(([, json]) => isRuntimeRecipeJson(json));
    expect(runtimes.length).toBe(2); // java + steamcmd
    for (const [, json] of runtimes) {
      const recipe: RuntimeRecipe = parseRuntimeRecipe(json);
      expect(recipe.type).toBe('runtime');
      expect(recipe.schema_version).toBe(4);
      expect(recipe.install.length).toBeGreaterThan(0);
      expect(recipe.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('validates every app recipe against the app schema', () => {
    const apps = FILES.filter(([path, json]) => !isRuntimeRecipeJson(json) && !path.includes('runtimes'));
    expect(apps.length).toBe(3); // vanilla, icarus, ricochet
    for (const [, json] of apps) {
      const recipe: Recipe = parseRecipe(json);
      expect(recipe.type).toBe('app');
      // Apps requiring runtimes resolve their ids as recipe slugs.
      for (const id of recipe.requires ?? []) {
        expect(id).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  it('every app requires its runtimes by id and the graph is closed', () => {
    const runtimeIds = new Set(
      FILES.filter(([, json]) => isRuntimeRecipeJson(json)).map(
        ([, json]) => (json as RuntimeRecipe).id,
      ),
    );
    const appRequires: Record<string, string[]> = {};
    for (const [path, json] of FILES) {
      if (isRuntimeRecipeJson(json) || path.includes('runtimes')) continue;
      const recipe = parseRecipe(json);
      appRequires[recipe.id] = recipe.requires ?? [];
      // A runtime required by an app must exist in the tree.
      for (const id of recipe.requires ?? []) {
        expect(runtimeIds, `unknown runtime ${id} required by ${recipe.id}`).toContain(id);
      }
    }
    expect(appRequires['minecraft-vanilla']).toContain('java');
    expect(appRequires['icarus']).toContain('steamcmd');
    expect(appRequires['ricochet']).toContain('steamcmd');
  });

  it('rejects a runtime recipe through the app schema (start is required)', () => {
    const java = FILES.find(([path]) => path.includes('runtimes') && path.includes('java'));
    expect(java).toBeDefined();
    expect(() => parseRecipe(java![1])).toThrow();
  });
});
