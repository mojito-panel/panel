import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { safeParsePlugin, findUnknownVariables } from '../src/plugin-schema';

const pluginPath = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../plugins/minecraft-vanilla.json',
);

const raw = JSON.parse(readFileSync(pluginPath, 'utf8'));

describe('plugin minecraft-vanilla', () => {
  it('est valide contre le schema v2', () => {
    const result = safeParsePlugin(raw);
    expect(result.success).toBe(true);
  });

  it('ne reference aucune variable inconnue', () => {
    const parsed = safeParsePlugin(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(findUnknownVariables(parsed.data)).toEqual([]);
    }
  });

  it('a les variables attendues avec defaults valides', () => {
    const parsed = safeParsePlugin(raw);
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
    ]);
  });
});
