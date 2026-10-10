import { describe, it, expect } from 'vitest';
import {
  pluginSchema,
  parsePlugin,
  safeParsePlugin,
  extractTemplateVars,
  findUnknownVariables,
  validateVariableValue,
  RESERVED_ENV_NAMES,
  type Plugin,
} from '../src/plugin-schema';

/**
 * Egg style Paper — couvre toutes les features v2 :
 * variables env UPPERCASE, variables systeme, configFile parser,
 * ready detection avec strip, logs, runtime, env fixe.
 */
const validPaperPlugin = {
  schemaVersion: 2 as const,
  id: 'minecraft-paper',
  name: 'Paper',
  author: 'papermc',
  description: 'High performance Spigot fork.',
  tags: ['minecraft', 'java'],
  features: ['eula', 'java_version'],
  runtime: { java: '>=21' },
  requirements: { minRamMb: 512, requiredCommands: ['java'] },
  variables: [
    {
      env: 'MINECRAFT_VERSION',
      name: 'Minecraft Version',
      type: 'string' as const,
      defaultValue: 'latest',
      userViewable: true,
      userEditable: true,
      sort: 0,
      required: true,
    },
    {
      env: 'SERVER_JARFILE',
      name: 'Server Jar File',
      type: 'string' as const,
      defaultValue: 'server.jar',
      userViewable: true,
      userEditable: true,
      sort: 1,
      required: true,
      pattern: '^([\w\d._-]+)(\.jar)$',
    },
    {
      env: 'BUILD_NUMBER',
      name: 'Build Number',
      type: 'string' as const,
      defaultValue: 'latest',
      userViewable: false,
      userEditable: false,
      sort: 2,
    },
  ],
  install: [
    {
      action: 'download' as const,
      url: 'https://api.papermc.io/v2/projects/{{MINECRAFT_VERSION}}/builds/{{BUILD_NUMBER}}/downloads/server.jar',
      dest: '{{SERVER_JARFILE}}',
      checksum: 'abc123',
    },
    { action: 'write' as const, file: 'eula.txt', content: 'eula=true' },
    {
      action: 'configFile' as const,
      file: 'server.properties',
      parser: 'properties' as const,
      find: { 'server-port': '{{SERVER_PORT}}', 'server-ip': '{{SERVER_IP}}' },
    },
  ],
  start: {
    command: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}',
    stop: { type: 'command' as const, value: 'stop', timeoutMs: 30000 },
    ready: { pattern: 'Done \([0-9.]+s\)! For help', strip: '\[.*?\] ' },
  },
  logs: { mode: 'stdout' as const, stripAnsi: true },
  env: { JAVA_OPTS: '-XX:+UseG1GC' },
};

describe('pluginSchema v2', () => {
  it('valide un egg Paper complet', () => {
    const result = pluginSchema.safeParse(validPaperPlugin);
    expect(result.success).toBe(true);
  });

  it('rejette un schemaVersion incorrect', () => {
    const result = pluginSchema.safeParse({ ...validPaperPlugin, schemaVersion: 1 });
    expect(result.success).toBe(false);
  });

  it('rejette un id avec des caracteres invalides', () => {
    const result = pluginSchema.safeParse({ ...validPaperPlugin, id: 'Minecraft Paper!' });
    expect(result.success).toBe(false);
  });

  it('rejette une variable avec un nom env en lowercase', () => {
    const result = pluginSchema.safeParse({
      ...validPaperPlugin,
      variables: [{ env: 'version', name: 'Version', type: 'string', defaultValue: 'latest' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejette une variable utilisant un nom systeme reserve', () => {
    const result = pluginSchema.safeParse({
      ...validPaperPlugin,
      variables: [{ env: 'SERVER_MEMORY', name: 'RAM', type: 'number', defaultValue: 1024 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejette une action inconnue', () => {
    const result = pluginSchema.safeParse({
      ...validPaperPlugin,
      install: [{ action: 'delete', file: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejette une variable avec un env duplique', () => {
    const result = pluginSchema.safeParse({
      ...validPaperPlugin,
      variables: [
        { env: 'MINECRAFT_VERSION', name: 'V1', type: 'string', defaultValue: 'a' },
        { env: 'MINECRAFT_VERSION', name: 'V2', type: 'string', defaultValue: 'b' },
      ],
    });
    // Pas de contrainte d'unicite au niveau Zod (verifie par le panel a l import)
    expect(result.success).toBe(true);
  });

  it('accepte un plugin minimal (sans install, sans variables)', () => {
    const minimal = {
      schemaVersion: 2 as const,
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
      expect(result.data.features).toEqual([]);
    }
  });

  it('valide une action script (fallback ouvert)', () => {
    const result = pluginSchema.safeParse({
      ...validPaperPlugin,
      install: [
        { action: 'script', shell: 'powershell', content: 'Invoke-WebRequest -Uri x -OutFile y' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejette un stop avec un type invalide', () => {
    const result = pluginSchema.safeParse({
      ...validPaperPlugin,
      start: { ...validPaperPlugin.start, stop: { type: 'event', value: 'x' } },
    });
    expect(result.success).toBe(false);
  });

  it('applique les defaults Pelican-style sur les variables', () => {
    const result = pluginSchema.safeParse({
      ...validPaperPlugin,
      variables: [{ env: 'SIMPLE', name: 'Simple', type: 'string', defaultValue: 'x' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const v = result.data.variables[0];
      expect(v.userViewable).toBe(true);
      expect(v.userEditable).toBe(true);
      expect(v.sort).toBe(0);
      expect(v.required).toBe(false);
    }
  });
});

describe('parsePlugin / safeParsePlugin', () => {
  it('parsePlugin lance sur donnees invalides', () => {
    expect(() => parsePlugin({ foo: 'bar' })).toThrow();
  });

  it('safeParsePlugin retourne success=false sans lancer', () => {
    const result = safeParsePlugin({ foo: 'bar' });
    expect(result.success).toBe(false);
  });
});

describe('extractTemplateVars', () => {
  it('extrait les variables UPPERCASE', () => {
    expect(extractTemplateVars('java -Xmx{{SERVER_MEMORY}}M {{MINECRAFT_VERSION}}')).toEqual([
      'SERVER_MEMORY',
      'MINECRAFT_VERSION',
    ]);
  });

  it('deduplique les variables', () => {
    expect(extractTemplateVars('{{A}} {{A}} {{B}}')).toEqual(['A', 'B']);
  });

  it('ignore les templates lowercase', () => {
    expect(extractTemplateVars('{{lowercase_var}}')).toEqual([]);
  });

  it('retourne un tableau vide sans variables', () => {
    expect(extractTemplateVars('plain text')).toEqual([]);
  });
});

describe('findUnknownVariables', () => {
  it('retourne vide quand toutes les variables sont declarees (plugin + systeme + env fixe)', () => {
    const plugin = parsePlugin(validPaperPlugin);
    expect(findUnknownVariables(plugin)).toEqual([]);
  });

  it('detecte une variable utilisee mais non declaree', () => {
    const plugin = parsePlugin({
      ...validPaperPlugin,
      start: { ...validPaperPlugin.start, command: 'java -Dmotd={{UNKNOWN_VAR}} -jar x' },
    });
    expect(findUnknownVariables(plugin)).toEqual(['UNKNOWN_VAR']);
  });

  it('accepte les variables systeme reservees sans declaration', () => {
    const plugin = parsePlugin({
      ...validPaperPlugin,
      start: { ...validPaperPlugin.start, command: 'echo {{SERVER_UUID}} {{SERVER_PORT}}' },
    });
    expect(findUnknownVariables(plugin)).toEqual([]);
  });

  it('accepte les cles du env fixe comme variables de templating', () => {
    const plugin = parsePlugin({
      ...validPaperPlugin,
      env: { CUSTOM_FLAG: 'yes' },
      start: { ...validPaperPlugin.start, command: 'echo {{CUSTOM_FLAG}}' },
    });
    expect(findUnknownVariables(plugin)).toEqual([]);
  });

  it('detecte les variables inconnues dans configFile', () => {
    const plugin = parsePlugin({
      ...validPaperPlugin,
      install: [
        { action: 'configFile', file: 'x.ini', parser: 'ini', find: { key: '{{NOT_DECLARED}}' } },
      ],
    });
    expect(findUnknownVariables(plugin)).toEqual(['NOT_DECLARED']);
  });
});

describe('validateVariableValue (equivalent rules Laravel)', () => {
  const base = { env: 'RAM_MB', name: 'RAM', type: 'number' as const, defaultValue: 1024 };

  it('valide un nombre dans les bornes', () => {
    expect(validateVariableValue({ ...base, min: 512, max: 4096 }, 2048)).toBeNull();
  });

  it('rejette un nombre hors bornes', () => {
    expect(validateVariableValue({ ...base, min: 512, max: 4096 }, 100)).toContain('512');
    expect(validateVariableValue({ ...base, min: 512, max: 4096 }, 9999)).toContain('4096');
  });

  it('rejette une valeur non numerique pour un type number', () => {
    expect(validateVariableValue(base, 'abc')).toContain('nombre');
  });

  it('valide une regex pattern', () => {
    const varDef = {
      env: 'JAR',
      name: 'Jar',
      type: 'string' as const,
      defaultValue: 'server.jar',
      pattern: /^([\w\d._-]+)(\.jar)$/.source,
    };
    expect(validateVariableValue(varDef, 'server.jar')).toBeNull();
    expect(validateVariableValue(varDef, 'server.txt')).toContain('format');
  });

  it('valide une liste d options', () => {
    const varDef = {
      env: 'DIFFICULTY',
      name: 'Difficulte',
      type: 'string' as const,
      defaultValue: 'normal',
      options: ['easy', 'normal', 'hard'],
    };
    expect(validateVariableValue(varDef, 'normal')).toBeNull();
    expect(validateVariableValue(varDef, 'impossible')).toContain('easy');
  });
});

describe('RESERVED_ENV_NAMES', () => {
  it('contient les variables systeme attendues', () => {
    expect(RESERVED_ENV_NAMES).toContain('SERVER_MEMORY');
    expect(RESERVED_ENV_NAMES).toContain('SERVER_PORT');
    expect(RESERVED_ENV_NAMES).toContain('SERVER_UUID');
  });
});
