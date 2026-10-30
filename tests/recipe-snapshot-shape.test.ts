import { describe, expect, it } from 'vitest';
import { isServerRecipeSnapshot } from '../src/server/recipe-snapshot';

/**
 * Shape gate of a server's stored recipe snapshot. A malformed document
 * must be REJECTED (the caller re-snapshots from the recipe row) — the
 * snapshot is what the agent installs with.
 */
describe('isServerRecipeSnapshot', () => {
  const recipe = { schema_version: 4, id: 'test-game', name: 'Test Game', author: 'T' };

  it('accepts a { recipe, runtimes } document', () => {
    expect(isServerRecipeSnapshot({ recipe, runtimes: [] })).toBe(true);
    expect(isServerRecipeSnapshot({ recipe, runtimes: [{ id: 'jdk' }] })).toBe(true);
  });

  it('rejects the legacy folded shape (no recipe id)', () => {
    // The 20261023143000 migration folded the old recipe-only column into
    // `{ recipe: <whole document>, runtimes }` — the inner object has no id.
    expect(
      isServerRecipeSnapshot({ recipe: { recipe, runtimes: [] }, runtimes: [] }),
    ).toBe(false);
  });

  it('rejects missing / malformed documents', () => {
    expect(isServerRecipeSnapshot(null)).toBe(false);
    expect(isServerRecipeSnapshot(undefined)).toBe(false);
    expect(isServerRecipeSnapshot({})).toBe(false);
    expect(isServerRecipeSnapshot({ recipe })).toBe(false);
    expect(isServerRecipeSnapshot({ recipe, runtimes: {} })).toBe(false);
    expect(isServerRecipeSnapshot({ recipe: null, runtimes: [] })).toBe(false);
  });
});
