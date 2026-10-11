import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { safeParseRecipe, findUnknownVariables, findToolFeatureErrors } from '../src/recipe-schema';

const recipePath = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../recipes/minecraft-vanilla.json',
);

const raw = JSON.parse(readFileSync(recipePath, 'utf8'));

describe('minecraft-vanilla recipe', () => {
  it('is valid against the v2 schema', () => {
    const result = safeParseRecipe(raw);
    expect(result.success).toBe(true);
  });

  it('references no unknown variables', () => {
    const parsed = safeParseRecipe(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(findUnknownVariables(parsed.data)).toEqual([]);
    }
  });

  it('has the expected variables with valid defaults', () => {
    const parsed = safeParseRecipe(raw);
    if (!parsed.success) throw parsed.error;
    const envs = parsed.data.variables.map((v) => v.env);
    expect(envs).toEqual([
      'MINECRAFT_VERSION',
      'ACCEPT_EULA',
      'SERVER_MOTD',
      'MAX_PLAYERS',
      'ONLINE_MODE',
      'VIEW_DISTANCE',
      'JVM_ARGS',
      'JAVA_VERSION',
    ]);
  });

  it('declares the java feature — JDK preloaded by the agent into the server .bin (no host Java required)', () => {
    const parsed = safeParseRecipe(raw);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.features).toContain('java');
    // The JDK is provided by the agent (java feature + JAVA_VERSION variable):
    // no download/extract steps left in the install script
    expect(parsed.data.install.some((a) => a.action === 'download' || a.action === 'extract')).toBe(false);
    // The start command calls java via the injected PATH
    expect(parsed.data.start.command).toContain('java -Xms');
    expect(parsed.data.runtime).toBeUndefined();
    // findToolFeatureErrors: java feature + JAVA_VERSION variable declared → OK
    expect(findToolFeatureErrors(parsed.data)).toEqual([]);
  });
});
