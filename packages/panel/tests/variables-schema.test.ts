import { describe, it, expect } from 'vitest';
import { makeUpdateServerVariablesSchema } from '../src/validators/server';
import type { PluginVariable } from '@mojito/contract';

/** Builds a plugin variable definition with sensible defaults. */
const variable = (overrides: Partial<PluginVariable> = {}): PluginVariable => ({
  env: 'TEST_VAR',
  name: 'Test',
  type: 'string',
  defaultValue: 'default',
  userViewable: true,
  userEditable: true,
  sort: 0,
  required: false,
  ...overrides,
});

describe('makeUpdateServerVariablesSchema', () => {
  it('accepts a valid record', () => {
    const schema = makeUpdateServerVariablesSchema([
      variable({ env: 'GAME_VERSION', name: 'Version' }),
      variable({ env: 'RAM_MB', name: 'RAM', type: 'number', min: 512, max: 65536 }),
    ]);
    const result = schema.safeParse({
      serverId: 'uuid',
      variables: { GAME_VERSION: '1.21', RAM_MB: 2048 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing required variable', () => {
    const schema = makeUpdateServerVariablesSchema([
      variable({ env: 'MUST_HAVE', name: 'Obligatoire', required: true }),
    ]);
    const result = schema.safeParse({
      serverId: 'uuid',
      variables: { MUST_HAVE: '' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['variables', 'MUST_HAVE']);
    expect(result.error?.issues[0]?.message).toBe('Obligatoire est requis');
  });

  it('accepts an empty value for a non-required variable', () => {
    const schema = makeUpdateServerVariablesSchema([variable()]);
    const result = schema.safeParse({
      serverId: 'uuid',
      variables: { TEST_VAR: '' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a number below min and above max', () => {
    const schema = makeUpdateServerVariablesSchema([
      variable({ env: 'RAM_MB', name: 'RAM', type: 'number', min: 512, max: 65536 }),
    ]);
    const tooLow = schema.safeParse({ serverId: 'uuid', variables: { RAM_MB: 100 } });
    expect(tooLow.success).toBe(false);
    expect(tooLow.error?.issues[0]?.message).toBe('RAM doit etre >= 512');

    const tooHigh = schema.safeParse({ serverId: 'uuid', variables: { RAM_MB: 999999 } });
    expect(tooHigh.success).toBe(false);
    expect(tooHigh.error?.issues[0]?.message).toBe('RAM doit etre <= 65536');
  });

  it('rejects a non-number for a number variable', () => {
    const schema = makeUpdateServerVariablesSchema([
      variable({ env: 'RAM_MB', name: 'RAM', type: 'number' }),
    ]);
    const result = schema.safeParse({
      serverId: 'uuid',
      variables: { RAM_MB: 'not-a-number' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('RAM doit etre un nombre');
  });

  it('rejects a pattern violation', () => {
    const schema = makeUpdateServerVariablesSchema([
      variable({ env: 'MINECRAFT_VERSION', name: 'Version', pattern: '^\\d+\\.\\d+(\\.\\d+)?$' }),
    ]);
    const result = schema.safeParse({
      serverId: 'uuid',
      variables: { MINECRAFT_VERSION: 'latest' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Version ne respecte pas le format attendu');
  });

  it('rejects a value outside the declared options', () => {
    const schema = makeUpdateServerVariablesSchema([
      variable({ env: 'DIFFICULTY', name: 'Difficulté', options: ['easy', 'normal', 'hard'] }),
    ]);
    const result = schema.safeParse({
      serverId: 'uuid',
      variables: { DIFFICULTY: 'nightmare' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Difficulté doit etre une des valeurs : easy, normal, hard',
    );
  });
});
