import { describe, it, expect } from 'vitest';

import { parseRecipe } from '../src/contract/recipe-schema';
import { normalizeStoredRecipe } from '../src/lib/stored-recipe';

/**
 * Stored recipes saved before the v4 cutover carry schema_version 1|2|3
 * plus the legacy `type`/`requires` and `docker_image`/`docker_images`
 * fields — every read path upgrades them in memory, so they must come
 * out shaped for the v4 contract (and valid). The runtimes an old recipe
 * kept in its image are NOT provisioned automatically — its install/start
 * commands must be rewritten with declarative download/extract actions.
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

  it('upgrades a stored v1 recipe to the v4 shape (type/requires/image stripped)', () => {
    const normalized = normalizeStoredRecipe(v1App);
    expect(normalized.schema_version).toBe(4);
    expect(normalized.type).toBeUndefined();
    expect(normalized.requires).toBeUndefined();
    expect(normalized.docker_image).toBeUndefined();
    expect(() => parseRecipe(normalized)).not.toThrow();
  });

  it('upgrades a stored v3 recipe (docker images stripped)', () => {
    const normalized = normalizeStoredRecipe({
      schema_version: 3,
      id: 'vanilla',
      name: 'Vanilla',
      author: 'mojito',
      docker_image: 'ghcr.io/mojito/windows-jdk21:latest',
      docker_images: { Java17: 'img:17' },
      start: { command: 'java -jar server.jar' },
    });
    expect(normalized.schema_version).toBe(4);
    expect(normalized.docker_image).toBeUndefined();
    expect(normalized.docker_images).toBeUndefined();
    expect(() => parseRecipe(normalized)).not.toThrow();
  });

  it('returns an already-v4 recipe untouched (same reference)', () => {
    const v4 = {
      schema_version: 4,
      id: 'x',
      name: 'n',
      author: 'a',
      start: { command: 'c' },
    };
    expect(normalizeStoredRecipe(v4)).toBe(v4);
  });

  it('does not mutate the stored JSON', () => {
    const stored = { ...v1App };
    normalizeStoredRecipe(stored);
    expect(stored.schema_version).toBe(1);
    expect(stored.type).toBe('app');
    expect(stored.requires).toEqual(['java']);
    expect(stored.docker_image).toBe('ghcr.io/mojito/windows-jdk21:latest');
  });
});
