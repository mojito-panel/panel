import { describe, expect, it } from 'vitest';

import { recipeGraphHashOf } from '../src/server/recipe-snapshot';

/**
 * The snapshot's stored graph hash vs the current graph — the "recipe
 * updated since the snapshot" signal. It must be CONTENT based: a
 * marketplace sync (or a no-op re-import) moves `recipe.updated_at`, but
 * never the hash.
 */
describe('recipeGraphHashOf', () => {
  const app = {
    schema_version: 4,
    id: 'minecraft',
    name: 'Minecraft',
    author: 'Tester',
    requires: ['java'],
    variables: [{ env: 'MC_VERSION', name: 'Version', type: 'string', default_value: 'latest' }],
  };
  const java = {
    schema_version: 4,
    type: 'runtime',
    id: 'java',
    name: 'Java',
    author: 'Tester',
    variables: [{ env: 'JAVA_VERSION', name: 'Java version', type: 'string', default_value: '21' }],
  };

  it('is stable for the same content', () => {
    expect(recipeGraphHashOf(app, [java])).toBe(recipeGraphHashOf(app, [java]));
  });

  it('ignores key order and the runtime resolution order', () => {
    // Same content as `app`, with the keys written in a different order.
    const reordered = {
      variables: app.variables,
      requires: app.requires,
      author: app.author,
      name: app.name,
      id: app.id,
      schema_version: app.schema_version,
    };
    const other = { ...java, id: 'bedrock' };
    expect(recipeGraphHashOf(reordered, [java, other])).toBe(recipeGraphHashOf(app, [other, java]));
  });

  it('changes when the app recipe changes', () => {
    const edited = { ...app, start: { command: 'java -jar server.jar' } };
    expect(recipeGraphHashOf(edited, [java])).not.toBe(recipeGraphHashOf(app, [java]));
  });

  it('changes when a required runtime changes', () => {
    const edited = { ...java, install: [{ action: 'download', url: 'x' }] };
    expect(recipeGraphHashOf(app, [edited])).not.toBe(recipeGraphHashOf(app, [java]));
  });

  it('changes when the graph itself changes (runtime added or removed)', () => {
    expect(recipeGraphHashOf(app, [])).not.toBe(recipeGraphHashOf(app, [java]));
  });
});
