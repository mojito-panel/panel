import { describe, it, expect } from 'vitest';
import { parseRecipe } from '../src/contract/recipe-schema';
import { normalizeStoredRecipe } from '../src/lib/stored-recipe';

/**
 * Stored recipes saved before the v3 cutover carry schema_version 1|2 plus
 * the legacy `type`/`requires` fields — every read path upgrades them in
 * memory, so they must come out shaped for the v3 contract. A legacy recipe
 * still missing `docker_image` is NOT fixed in memory (the agent rejects
 * the install — the recipe must be rewritten for containers).
 */
describe('normalizeStoredRecipe', () => {
  const v1App = {
    schema_version: 1,
    type: 'app',
    id: 'vanilla',
    name: 'Vanilla',
    author: 'mojito',
    docker_image: 'ghcr.io/mojito/windows-jdk21:latest',
    requires: ['java'],
    start: { command: 'java -jar server.jar' },
  };

  it('upgrades a stored v1 recipe to the v3 shape (type/requires stripped)', () => {
    const normalized = normalizeStoredRecipe(v1App);
    expect(normalized.schema_version).toBe(3);
    expect(normalized.type).toBeUndefined();
    expect(normalized.requires).toBeUndefined();
    expect(() => parseRecipe(normalized)).not.toThrow();
  });

  it('upgrades a stored v2 recipe (no type) to the v3 shape', () => {
    const normalized = normalizeStoredRecipe({
      schema_version: 2,
      id: 'vanilla',
      name: 'Vanilla',
      author: 'mojito',
      docker_image: 'ghcr.io/mojito/windows-jdk21:latest',
      start: { command: 'java -jar server.jar' },
    });
    expect(normalized.schema_version).toBe(3);
    expect(() => parseRecipe(normalized)).not.toThrow();
  });

  it('returns an already-v3 recipe untouched (same reference)', () => {
    const v3 = {
      schema_version: 3,
      id: 'x',
      name: 'n',
      author: 'a',
      docker_image: 'img',
      start: { command: 'c' },
    };
    expect(normalizeStoredRecipe(v3)).toBe(v3);
  });

  it('does not mutate the stored JSON', () => {
    const stored = { ...v1App };
    normalizeStoredRecipe(stored);
    expect(stored.schema_version).toBe(1);
    expect(stored.type).toBe('app');
    expect(stored.requires).toEqual(['java']);
  });
});
