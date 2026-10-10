import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { safeParsePlugin, findUnknownVariables } from '../src/plugin-schema';

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
      'RICOCHET_MAP',
      'MAX_PLAYERS',
      'RCON_PASSWORD',
      'MP_TIMELIMIT',
    ]);
  });

  it('declare la feature steamcmd et embarque SteamCMD dans .bin/steamcmd (pas de client Steam hote requis)', () => {
    const parsed = safeParsePlugin(raw);
    if (!parsed.success) throw parsed.error;
    const install = parsed.data.install;
    // 3 premières étapes : download SteamCMD → extract → cleanup zip
    expect(install[0]).toMatchObject({ action: 'download', dest: '.bin/steamcmd.zip' });
    expect(String(install[0].url)).toBe('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip');
    expect(install[1]).toMatchObject({
      action: 'extract',
      archive: '.bin/steamcmd.zip',
      dest: '.bin/steamcmd',
    });
    expect(install[2]).toMatchObject({ action: 'command', command: 'del .bin\\steamcmd.zip' });

    expect(parsed.data.features).toContain('steamcmd');
    expect(parsed.data.runtime).toBeUndefined();

    // SteamCMD : warmup auto-update (exit 7 attendu) + HLDS (app 90) + mod
    // ricochet, login anonymous, installé deux fois (bug GoldSrc). Le code 7
    // (relance après auto-update SteamCMD) est toléré via successCodes.
    const BS = String.fromCharCode(92);
    const steamcmdExe = '.bin' + BS + 'steamcmd' + BS + 'steamcmd.exe';
    const commands = install.flatMap((a) => (a.action === 'command' ? [a.command] : []));
    expect(commands.length).toBe(4);

    // Étape 4 (install[3]) : warmup — auto-update SteamCMD seul
    const warmup = install[3];
    if (warmup.action !== 'command') throw new Error('l’étape 4 doit être la warmup steamcmd');
    expect(warmup.command).toBe(steamcmdExe + ' +quit');
    expect(warmup.successCodes).toEqual([0, 7]);

    // Étapes suivantes : installation HLDS en deux passes
    for (const action of install) {
      if (action.action !== 'command' || !action.command.includes('+app_update 90')) continue;
      expect(action.successCodes).toEqual([0, 7]);
      expect(action.command).toContain(steamcmdExe);
      expect(action.command).toContain('+force_install_dir "{{SERVER_INSTALL_DIR}}"');
      expect(action.command).toContain('+login anonymous');
      expect(action.command).toContain('+app_set_config 90 mod ricochet');
      expect(action.command).toContain('+app_update 90');
      // SteamCMD n'imprime pas sa progression sur un pipe → tail de son log
      expect(action.tail).toMatchObject({
        file: '.bin/steamcmd/logs/content_log.txt',
        filter: 'state changed|update started|Fully Installed',
      });
    }
    expect(commands[3]).toContain('validate');
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
