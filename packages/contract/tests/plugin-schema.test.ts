import { describe, it, expect } from 'vitest';
import {
  pluginSchema,
  parsePlugin,
  safeParsePlugin,
  extractTemplateVars,
  findUnknownVariables,
} from '../src/plugin-schema';

const validMinecraftPlugin = {
  schemaVersion: 1 as const,
  id: 'minecraft-vanilla',
  name: 'Minecraft Vanilla',
  author: 'moi',
  tags: ['minecraft', 'java'],
  requirements: { minRamMb: 512 },
  variables: [
    { id: 'ram_mb', type: 'number' as const, default: 2048, label: 'RAM (Mo)', min: 512, max: 16384 },
    { id: 'motd', type: 'string' as const, default: 'Mon serveur', label: 'MOTD' },
    { id: 'version', type: 'string' as const, default: '1.21.4', label: 'Version' },
  ],
  install: [
    { action: 'download' as const, url: 'https://.../server-{{version}}.jar', dest: 'server.jar' },
    { action: 'write' as const, file: 'eula.txt', content: 'eula=true' },
    { action: 'replace' as const, file: 'server.properties', find: 'motd=', replace: 'motd={{motd}}' },
  ],
  start: {
    command: 'java -Xms{{ram_mb}}M -Xmx{{ram_mb}}M -jar server.jar nogui',
    stop: { type: 'command' as const, value: 'stop' },
    readyPattern: 'Done \([0-9.]+s\)! For help',
  },
  env: { JAVA_OPTS: '-XX:+UseG1GC' },
};

describe('pluginSchema', () => {
  it('valide un plugin Minecraft complet', () => {
    const result = pluginSchema.safeParse(validMinecraftPlugin);
    expect(result.success).toBe(true);
  });

  it('rejette un schemaVersion incorrect', () => {
    const result = pluginSchema.safeParse({ ...validMinecraftPlugin, schemaVersion: 2 });
    expect(result.success).toBe(false);
  });

  it('rejette un id avec des caractères invalides', () => {
    const result = pluginSchema.safeParse({ ...validMinecraftPlugin, id: 'Minecraft Vanilla!' });
    expect(result.success).toBe(false);
  });

  it('rejette une variable avec un id invalide', () => {
    const result = pluginSchema.safeParse({
      ...validMinecraftPlugin,
      variables: [{ id: '123bad', type: 'string', default: 'x', label: 'Bad' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejette une action inconnue', () => {
    const result = pluginSchema.safeParse({
      ...validMinecraftPlugin,
      install: [{ action: 'delete', file: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepte un plugin minimal (sans install, sans variables)', () => {
    const minimal = {
      schemaVersion: 1 as const,
      id: 'test',
      name: 'Test',
      author: 'moi',
      start: { command: 'echo hello' },
    };
    const result = pluginSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.variables).toEqual([]);
      expect(result.data.install).toEqual([]);
      expect(result.data.tags).toEqual([]);
    }
  });

  it('rejette un stop avec un type invalide', () => {
    const result = pluginSchema.safeParse({
      ...validMinecraftPlugin,
      start: { ...validMinecraftPlugin.start, stop: { type: 'event', value: 'x' } },
    });
    expect(result.success).toBe(false);
  });
});

describe('parsePlugin / safeParsePlugin', () => {
  it('parsePlugin lance sur données invalides', () => {
    expect(() => parsePlugin({ foo: 'bar' })).toThrow();
  });

  it('safeParsePlugin retourne success=false sans lancer', () => {
    const result = safeParsePlugin({ foo: 'bar' });
    expect(result.success).toBe(false);
  });
});

describe('extractTemplateVars', () => {
  it('extrait les variables simples', () => {
    expect(extractTemplateVars('java -Xmx{{ram_mb}}M {{motd}}')).toEqual(['ram_mb', 'motd']);
  });

  it('gère les espaces dans les accolades', () => {
    expect(extractTemplateVars('{{ version }}')).toEqual(['version']);
  });

  it('déduplique les variables', () => {
    expect(extractTemplateVars('{{a}} {{a}} {{b}}')).toEqual(['a', 'b']);
  });

  it('retourne un tableau vide sans variables', () => {
    expect(extractTemplateVars('plain text')).toEqual([]);
  });
});

describe('findUnknownVariables', () => {
  it('retourne vide quand toutes les variables sont déclarées', () => {
    const plugin = parsePlugin(validMinecraftPlugin);
    expect(findUnknownVariables(plugin)).toEqual([]);
  });

  it('détecte une variable utilisée mais non déclarée', () => {
    const plugin = parsePlugin({
      ...validMinecraftPlugin,
      start: { command: 'java -jar {{version}}.jar -Xmx{{ram_mb}}M -Dmotd={{unknown_var}}' },
    });
    expect(findUnknownVariables(plugin)).toEqual(['unknown_var']);
  });

  it('détecte les variables inconnues dans les actions install', () => {
    const plugin = parsePlugin({
      ...validMinecraftPlugin,
      install: [{ action: 'write', file: 'test.txt', content: 'hello {{not_declared}}' }],
    });
    expect(findUnknownVariables(plugin)).toEqual(['not_declared']);
  });

  it('détecte les variables inconnues dans env', () => {
    const plugin = parsePlugin({
      ...validMinecraftPlugin,
      env: { MY_VAR: '{{env_unknown}}' },
    });
    expect(findUnknownVariables(plugin)).toEqual(['env_unknown']);
  });
});
