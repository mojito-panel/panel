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
      'JAVA_MAJOR',
    ]);
  });

  it('embarque un JRE portable dans .bin/java (pas de Java hôte requis)', () => {
    const parsed = safeParsePlugin(raw);
    if (!parsed.success) throw parsed.error;
    const install = parsed.data.install;
    // 3 premières étapes : download JRE → extract → cleanup zip
    expect(install[0]).toMatchObject({ action: 'download', dest: '.bin/java.zip' });
    expect(String(install[0].url)).toContain('aka.ms/download-jdk/microsoft-jdk-{{JAVA_MAJOR}}-windows-x64.zip');
    expect(install[0].url).toContain('{{JAVA_MAJOR}}');
    expect(install[1]).toMatchObject({
      action: 'extract',
      archive: '.bin/java.zip',
      dest: '.bin/java',
      stripComponents: 1,
    });
    const BS = String.fromCharCode(92);
    expect(parsed.data.start.command).toContain('.bin' + BS + 'java' + BS + 'bin' + BS + 'java.exe');
    expect(parsed.data.runtime).toBeUndefined();
  });
});
