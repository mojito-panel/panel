import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { safeParsePlugin, findUnknownVariables, findToolFeatureErrors } from '../src/plugin-schema';

const pluginPath = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../plugins/ricochet.json',
);

const raw = JSON.parse(readFileSync(pluginPath, 'utf8'));

describe('plugin ricochet', () => {
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
      'STEAM_APP_ID',
      'STEAM_MOD',
      'RICOCHET_MAP',
      'MAX_PLAYERS',
      'RCON_PASSWORD',
      'MP_TIMELIMIT',
    ]);
  });

  it('declare la feature steamcmd — SteamCMD et le contenu gérés par l’agent (pas de client Steam hôte requis)', () => {
    const parsed = safeParsePlugin(raw);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.features).toContain('steamcmd');
    expect(parsed.data.runtime).toBeUndefined();

    // La feature steamcmd délègue tout à l'agent : préchargement du binaire
    // dans le .bin du serveur, auto-install du contenu (app_update 90 +
    // passe validate, login anonymous, +app_set_config mod ricochet).
    // Le script d'installation ne contient plus AUCUNE étape steamcmd.
    expect(parsed.data.install.every((a) => a.action !== 'command')).toBe(true);
    expect(
      parsed.data.install.some((a) => a.action === 'download' || a.action === 'extract'),
    ).toBe(false);

    // Paramètres lus par l'agent : variables dédiées (defaults sains)
    const variables = Object.fromEntries(parsed.data.variables.map((v) => [v.env, v]));
    expect(variables.STEAM_APP_ID.defaultValue).toBe('90');
    expect(variables.STEAM_MOD.defaultValue).toBe('ricochet');

    // findToolFeatureErrors : feature steamcmd + variables déclarées → OK
    expect(findToolFeatureErrors(parsed.data)).toEqual([]);
  });

  it('demarre hlds.exe avec le mod ricochet sur le port alloue', () => {
    const parsed = safeParsePlugin(raw);
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
