import { describe, it, expect } from 'vitest';

import type { RecipeVariable } from '~/contract';
import { mergeVariableDefinitions, mergeVariableValues } from '~/lib/recipe-merge';

/** Minimal variable definition fixture. */
function variable(env: string, overrides: Partial<RecipeVariable> = {}): RecipeVariable {
  return {
    env,
    name: env,
    description: '',
    type: 'string',
    default_value: `default-${env}`,
    user_viewable: true,
    user_editable: true,
    sort: 0,
    required: false,
    ...overrides,
  };
}

describe('mergeVariableDefinitions', () => {
  it('appends runtime variables not declared by the app, as server-editable knobs', () => {
    const app = [variable('SERVER_JAVA', { sort: 1 })];
    // The java runtime declares JAVA_VERSION as hidden/non-editable — on a
    // server it becomes a user-editable knob (the past behavior restored).
    const runtime = [
      variable('JAVA_VERSION', { user_viewable: false, user_editable: false, sort: 0 }),
    ];

    const merged = mergeVariableDefinitions(app, [runtime]);

    expect(merged.map((v) => v.env)).toEqual(['JAVA_VERSION', 'SERVER_JAVA']);
    const java = merged[0];
    expect(java.user_viewable).toBe(true);
    expect(java.user_editable).toBe(true);
    expect(java.default_value).toBe('default-JAVA_VERSION');
  });

  it('keeps the APP declaration when both recipes declare the same env', () => {
    const app = [variable('JAVA_VERSION', { default_value: '21', user_editable: true, sort: 0 })];
    const runtime = [
      variable('JAVA_VERSION', { default_value: '25', user_editable: false, sort: 0 }),
    ];

    const merged = mergeVariableDefinitions(app, [runtime]);

    expect(merged).toHaveLength(1);
    expect(merged[0].default_value).toBe('21');
    expect(merged[0].user_editable).toBe(true);
  });

  it('merges several runtimes without duplicating a shared env', () => {
    const app = [variable('SERVER_PORT', { sort: 0 })];
    const first = [variable('JAVA_VERSION', { sort: 0 }), variable('SHARED_ENV', { sort: 0 })];
    const second = [variable('JAVA_VERSION', { sort: 0 }), variable('SHARED_ENV', { sort: 0 })];

    const merged = mergeVariableDefinitions(app, [first, second]);

    expect(merged.map((v) => v.env).sort()).toEqual(['JAVA_VERSION', 'SERVER_PORT', 'SHARED_ENV']);
  });
});

describe('mergeVariableValues', () => {
  const definitions = [
    variable('SERVER_JAVA', { default_value: '17' }),
    variable('JAVA_VERSION', { default_value: '25' }),
    variable('SERVER_PORT', { default_value: '25565' }),
  ];

  it('keeps submitted values and fills defaults for the rest', () => {
    const merged = mergeVariableValues(definitions, { JAVA_VERSION: '21' });

    expect(merged).toEqual({
      SERVER_JAVA: '17',
      JAVA_VERSION: '21',
      SERVER_PORT: '25565',
    });
  });

  it('drops values of envs that are no longer defined (reload/change)', () => {
    const merged = mergeVariableValues(definitions.slice(0, 2), {
      JAVA_VERSION: '21',
      SERVER_PORT: '25565',
    });

    expect(merged).toEqual({ SERVER_JAVA: '17', JAVA_VERSION: '21' });
  });

  it('treats an empty string as unset (the default applies)', () => {
    const merged = mergeVariableValues(definitions, { SERVER_JAVA: '' });

    expect(merged.SERVER_JAVA).toBe('17');
  });
});
