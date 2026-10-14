import { describe, it, expect } from 'vitest';
import { parseRecipe, parseRuntimeRecipe } from '../src/contract/recipe-schema';
import { normalizeStoredRecipe } from '../src/lib/stored-recipe';

/**
 * Stored recipes saved before the v1 cutover carry schemaVersion 2/3 (and
 * v2 has no `type`) — every read path upgrades them in memory, so they
 * must come out valid against the v1 contract.
 */
describe('normalizeStoredRecipe', () => {
  const v2App = {
    schemaVersion: 2,
    id: 'vanilla',
    name: 'Vanilla',
    author: 'mojito',
    start: { command: 'java -jar server.jar' },
  };

  it('upgrades a stored v2 recipe (no type) to a v1 app recipe', () => {
    const normalized = normalizeStoredRecipe(v2App);
    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.type).toBe('app');
    expect(() => parseRecipe(normalized)).not.toThrow();
  });

  it('upgrades a stored v3 app recipe to v1 (type and requires kept)', () => {
    const normalized = normalizeStoredRecipe({
      ...v2App,
      schemaVersion: 3,
      type: 'app',
      requires: ['java'],
    });
    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.type).toBe('app');
    expect(normalized.requires).toEqual(['java']);
    expect(() => parseRecipe(normalized)).not.toThrow();
  });

  it('upgrades a stored v3 runtime recipe to v1 (type kept)', () => {
    const normalized = normalizeStoredRecipe({
      schemaVersion: 3,
      type: 'runtime',
      id: 'java',
      name: 'Java',
      author: 'mojito',
      install: [],
    });
    expect(normalized.schemaVersion).toBe(1);
    expect(normalized.type).toBe('runtime');
    expect(() => parseRuntimeRecipe(normalized)).not.toThrow();
  });

  it('returns an already-v1 recipe untouched (same reference)', () => {
    const v1 = {
      schemaVersion: 1,
      type: 'app',
      id: 'x',
      name: 'n',
      author: 'a',
      start: { command: 'c' },
    };
    expect(normalizeStoredRecipe(v1)).toBe(v1);
  });

  it('does not mutate the stored JSON', () => {
    const stored = { ...v2App };
    normalizeStoredRecipe(stored);
    expect(stored.schemaVersion).toBe(2);
    expect(stored.type).toBeUndefined();
  });
});
