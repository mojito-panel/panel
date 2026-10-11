import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { safeParseRecipe, findUnknownVariables, findToolFeatureErrors } from '../src/recipe-schema';

const recipePath = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../recipes/ricochet.json',
);

const raw = JSON.parse(readFileSync(recipePath, 'utf8'));

describe('ricochet recipe', () => {
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
      'STEAM_APP_ID',
      'STEAM_MOD',
      'RICOCHET_MAP',
      'MAX_PLAYERS',
      'RCON_PASSWORD',
      'MP_TIMELIMIT',
    ]);
  });

  it('declares the steamcmd feature — SteamCMD and content handled by the agent (no host Steam client required)', () => {
    const parsed = safeParseRecipe(raw);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.features).toContain('steamcmd');
    expect(parsed.data.runtime).toBeUndefined();

    // The steamcmd feature delegates everything to the agent: binary preloading
    // into the server .bin, content auto-install (app_update 90 + validate pass,
    // anonymous login, +app_set_config mod ricochet).
    // The install script no longer contains ANY steamcmd step.
    expect(parsed.data.install.every((a) => a.action !== 'command')).toBe(true);
    expect(
      parsed.data.install.some((a) => a.action === 'download' || a.action === 'extract'),
    ).toBe(false);

    // Parameters read by the agent: dedicated variables (sane defaults)
    const variables = Object.fromEntries(parsed.data.variables.map((v) => [v.env, v]));
    expect(variables.STEAM_APP_ID.defaultValue).toBe('90');
    expect(variables.STEAM_MOD.defaultValue).toBe('ricochet');

    // findToolFeatureErrors: steamcmd feature + declared variables → OK
    expect(findToolFeatureErrors(parsed.data)).toEqual([]);
  });

  it('starts hlds.exe with the ricochet mod on the allocated port', () => {
    const parsed = safeParseRecipe(raw);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.start.command).toContain('hlds.exe -console -game ricochet');
    expect(parsed.data.start.command).toContain('+ip {{SERVER_IP}}');
    expect(parsed.data.start.command).toContain('+port {{SERVER_PORT}}');
    expect(parsed.data.start.command).toContain('+map {{RICOCHET_MAP}}');
    expect(parsed.data.start.command).toContain('-maxplayers {{MAX_PLAYERS}}');
    expect(parsed.data.start.workingDirectory).toBe('{{SERVER_INSTALL_DIR}}');
    expect(parsed.data.start.stop).toMatchObject({ type: 'command', value: 'quit' });
    expect(parsed.data.logs).toMatchObject({ mode: 'stdout' });
  });
});
