import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { safeParsePlugin, findUnknownVariables, findToolFeatureErrors } from '../src/plugin-schema';

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
      'JAVA_VERSION',
    ]);
  });

  it('declare la feature java — JDK préchargé par l’agent dans le .bin du serveur (pas de Java hôte requis)', () => {
    const parsed = safeParsePlugin(raw);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.features).toContain('java');
    // Le JDK est fourni par l'agent (feature java + variable JAVA_VERSION) :
    // plus aucune étape download/extract dans le script d'installation
    expect(parsed.data.install.some((a) => a.action === 'download' || a.action === 'extract')).toBe(false);
    // La commande de démarrage appelle java via le PATH injecté
    expect(parsed.data.start.command).toContain('java -Xms');
    expect(parsed.data.runtime).toBeUndefined();
    // findToolFeatureErrors : feature java + variable JAVA_VERSION déclarée → OK
    expect(findToolFeatureErrors(parsed.data)).toEqual([]);
  });
});
