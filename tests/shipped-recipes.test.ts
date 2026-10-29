import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isRuntimeRecipeJson, parseRecipe, parseRuntimeRecipe } from '~/contract';
import { RECIPE_FILE_PATTERN } from '../src/server/registry-entries';

/**
 * Cross-repo contract test: EVERY recipe JSON of the shipped recipes repo
 * (sibling checkout `../recipes`, next to this repo's root) must validate
 * against the panel's recipe contract — the contract is the source of truth
 * the agent enforces too, so a recipe that fails here would fail every
 * install.
 *
 * The recipes repo is NOT part of this repository (it may be absent, e.g.
 * the panel's own CI) — the suite SKIPS itself when the sibling checkout
 * or any recipe file cannot be found, so `npm test` stays green either way.
 */

const RECIPES_DIR = join(fileURLToPath(import.meta.url), '..', '..', '..', 'recipes');

/**
 * Lists the recipe files under the recipes repo — [] when it is absent.
 * The file pattern is the MARKETPLACE's own (RECIPE_FILE_PATTERN, shared
 * import from src/server/registry-entries): `recipe-*.json` anywhere and
 * NESTED `<id>.json`, exactly what a registry sync would catalog — the
 * shipped repo and the marketplace must never disagree on what a recipe
 * file is.
 */
function listRecipeFiles(): string[] {
  try {
    return readdirSync(RECIPES_DIR, { recursive: true, encoding: 'utf-8' })
      .filter((file) => RECIPE_FILE_PATTERN.test(file.replaceAll('\\', '/')))
      .map((file) => join(RECIPES_DIR, file))
      .filter((file) => existsSync(file));
  } catch {
    return [];
  }
}

const recipeFiles = listRecipeFiles();

describe.skipIf(recipeFiles.length === 0)('shipped recipes vs the contract', () => {
  it('finds recipe files in the sibling recipes repo', () => {
    expect(recipeFiles.length, `no recipe-*.json under ${RECIPES_DIR}`).toBeGreaterThan(0);
  });

  for (const file of recipeFiles) {
    const id = relative(RECIPES_DIR, file).replaceAll('\\', '/');

    it(`validates ${id} against the contract`, () => {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
      // Dispatch BEFORE schema validation: runtime recipes (type: "runtime")
      // are validated by the runtime schema, app recipes by the app schema.
      if (isRuntimeRecipeJson(raw)) {
        expect(() => parseRuntimeRecipe(raw), `${id} must be a valid runtime recipe`).not.toThrow();
      } else {
        expect(() => parseRecipe(raw), `${id} must be a valid app recipe`).not.toThrow();
      }
    });
  }
});
