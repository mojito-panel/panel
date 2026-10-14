import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRecipe,
  parseRuntimeRecipe,
  isRuntimeRecipeJson,
  findToolFeatureErrors,
  validateBackupIncludePattern,
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

describe('recipes tree (contract v3)', () => {
  it('has files', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(5);
  });

  it('validates every runtime recipe against the v3 runtime schema', () => {
    const runtimes = FILES.filter(([, json]) => isRuntimeRecipeJson(json));
    expect(runtimes.length).toBe(2); // java + steamcmd
    for (const [path, json] of runtimes) {
      const recipe: RuntimeRecipe = parseRuntimeRecipe(json);
      expect(isRuntimeRecipeJson(json)).toBe(true);
      expect(recipe.type).toBe('runtime');
      expect(recipe.install.length).toBeGreaterThan(0);
      expect(recipe.id).toMatch(/^[a-z0-9-]+$/);
      expect(validateBackupIncludePattern, 'sanity').toBeDefined();
      void path;
    }
  });

  it('validates every app recipe against the app schema (v2 or v3)', () => {
    const apps = FILES.filter(([path, json]) => !isRuntimeRecipeJson(json) && !path.includes('runtimes'));
    expect(apps.length).toBe(3); // vanilla, icarus, ricochet
    for (const [, json] of apps) {
      const recipe: Recipe = parseRecipe(json);
      expect(findToolFeatureErrors(recipe)).toEqual([]);
      // v3 apps requiring runtimes must not mix with tool features.
      if ((recipe.requires ?? []).length > 0) {
        expect(recipe.features).not.toContain('java');
        expect(recipe.features).not.toContain('steamcmd');
      }
    }
  });

  it('migrated the steamcmd apps to explicit install steps', () => {
    for (const [path, json] of FILES) {
      if (!path.includes('steamcmd') || path.includes('runtimes')) continue;
      const recipe: Recipe = parseRecipe(json);
      expect(recipe.requires).toContain('steamcmd');
      const commands = recipe.install.filter((a) => a.action === 'command');
      // Two passes: app_update then app_update validate (the first Steam
      // download can be partial — known SteamCMD bug).
      expect(commands.length).toBe(2);
      expect(commands[0].successCodes).toEqual([0, 7]);
      expect(commands[1].command).toContain('validate');
      expect(commands[0].tail?.file).toBe('.bin/steamcmd/logs/content_log.txt');
    }
  });

  it('rejects a runtime recipe through the app schema (start is required)', () => {
    const java = FILES.find(([path]) => path.includes('runtimes') && path.includes('java'));
    expect(java).toBeDefined();
    expect(() => parseRecipe(java![1])).toThrow();
  });
});
