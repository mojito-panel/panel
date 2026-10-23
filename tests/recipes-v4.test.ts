import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeParseRecipe } from '../src/contract/recipe-schema';

/**
 * The recipes of the recipes repo must always validate against the
 * CURRENT contract version — a recipe drift breaks installs, not tests.
 */
const recipesRoot = join(__dirname, '..', '..', 'recipes');
const recipeFiles = [
  'minecraft/vanilla/recipe-minecraft-vanilla.json',
  'steamcmd/enshrouded/recipe-enshrouded.json',
  'steamcmd/icarus/recipe-icarus.json',
  'steamcmd/palworld/recipe-palworld.json',
  'steamcmd/ricochet/recipe-ricochet.json',
];

describe('shipped recipes (recipes repo)', () => {
  for (const file of recipeFiles) {
    it(`${file} parses against the contract`, () => {
      const raw = readFileSync(join(recipesRoot, file), 'utf8');
      const result = safeParseRecipe(JSON.parse(raw));
      if (!result.success) {
        throw new Error(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      expect(result.data.schema_version).toBe(4);
      expect(result.data).not.toHaveProperty('docker_image');
    });
  }
});
