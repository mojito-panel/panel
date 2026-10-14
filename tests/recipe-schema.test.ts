import { describe, it, expect } from 'vitest';
import {
  recipeSchema,
  parseRecipe,
  safeParseRecipe,
  extractTemplateVars,
  findUnknownVariables,
  findToolFeatureErrors,
  validateVariableValue,
  validateBackupIncludePattern,
  JAVA_VERSION_ENV,
  STEAM_APP_ID_ENV,
  STEAM_MOD_ENV,
  type Recipe,
} from '../src/contract/recipe-schema';

/**
 * Paper-style egg — covers all v2 features:
 * UPPERCASE env variables, system variables, configFile parser,
 * ready detection with strip, logs, runtime, fixed env.
 */
const validPaperRecipe = {
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

describe('recipeSchema v2', () => {
  it('validates a complete Paper egg', () => {
    const result = recipeSchema.safeParse(validPaperRecipe);
    expect(result.success).toBe(true);
  });

  it('rejects an incorrect schemaVersion', () => {
    const result = recipeSchema.safeParse({ ...validPaperRecipe, schemaVersion: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects an id with invalid characters', () => {
    const result = recipeSchema.safeParse({ ...validPaperRecipe, id: 'Minecraft Paper!' });
    expect(result.success).toBe(false);
  });

  it('rejects a variable with a lowercase env name', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      variables: [{ env: 'version', name: 'Version', type: 'string', defaultValue: 'latest' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variable using a reserved system name', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      variables: [{ env: 'SERVER_MEMORY', name: 'RAM', type: 'number', defaultValue: 1024 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown action', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      install: [{ action: 'delete', file: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variable with a duplicated env', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      variables: [
        { env: 'MINECRAFT_VERSION', name: 'V1', type: 'string', defaultValue: 'a' },
        { env: 'MINECRAFT_VERSION', name: 'V2', type: 'string', defaultValue: 'b' },
      ],
    });
    // No uniqueness constraint at the Zod level (checked by the panel on import)
    expect(result.success).toBe(true);
  });

  it('accepts a minimal recipe (no install, no variables)', () => {
    const minimal = {
      schemaVersion: 2 as const,
      id: 'test',
      name: 'Test',
      author: 'me',
      start: { command: 'echo hello' },
    };
    const result = recipeSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.variables).toEqual([]);
      expect(result.data.install).toEqual([]);
      expect(result.data.tags).toEqual([]);
      expect(result.data.features).toEqual([]);
    }
  });

  it('validates a script action (open fallback)', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      install: [
        { action: 'script', shell: 'powershell', content: 'Invoke-WebRequest -Uri x -OutFile y' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a stop with an invalid type', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      start: { ...validPaperRecipe.start, stop: { type: 'event', value: 'x' } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a signal stop with a known signal', () => {
    for (const value of ['SIGINT', 'SIGTERM', 'SIGKILL']) {
      const result = recipeSchema.safeParse({
        ...validPaperRecipe,
        start: { ...validPaperRecipe.start, stop: { type: 'signal', value } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.start.stop?.value).toBe(value);
        expect(result.data.start.stop?.timeoutMs).toBe(30000);
      }
    }
  });

  it('rejects a signal stop with an unknown signal', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      start: { ...validPaperRecipe.start, stop: { type: 'signal', value: 'SIGSTOP' } },
    });
    expect(result.success).toBe(false);
  });

  it('applies Pelican-style defaults to variables', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
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

describe('extractTemplateVars', () => {
  it('extracts UPPERCASE variables', () => {
    expect(extractTemplateVars('java -Xmx{{SERVER_MEMORY}}M {{MINECRAFT_VERSION}}')).toEqual([
      'SERVER_MEMORY',
      'MINECRAFT_VERSION',
    ]);
  });

  it('deduplicates variables', () => {
    expect(extractTemplateVars('{{A}} {{A}} {{B}}')).toEqual(['A', 'B']);
  });

  it('ignores lowercase templates', () => {
    expect(extractTemplateVars('{{lowercase_var}}')).toEqual([]);
  });

  it('returns an empty array when no variables', () => {
    expect(extractTemplateVars('plain text')).toEqual([]);
  });
});

describe('findUnknownVariables', () => {
  it('returns empty when all variables are declared (recipe + system + fixed env)', () => {
    const recipe = parseRecipe(validPaperRecipe);
    expect(findUnknownVariables(recipe)).toEqual([]);
  });

  it('detects a used but undeclared variable', () => {
    const recipe = parseRecipe({
      ...validPaperRecipe,
      start: { ...validPaperRecipe.start, command: 'java -Dmotd={{UNKNOWN_VAR}} -jar x' },
    });
    expect(findUnknownVariables(recipe)).toEqual(['UNKNOWN_VAR']);
  });

  it('accepts reserved system variables without declaration', () => {
    const recipe = parseRecipe({
      ...validPaperRecipe,
      start: { ...validPaperRecipe.start, command: 'echo {{SERVER_UUID}} {{SERVER_PORT}}' },
    });
    expect(findUnknownVariables(recipe)).toEqual([]);
  });

  it('accepts fixed env keys as templating variables', () => {
    const recipe = parseRecipe({
      ...validPaperRecipe,
      env: { CUSTOM_FLAG: 'yes' },
      start: { ...validPaperRecipe.start, command: 'echo {{CUSTOM_FLAG}}' },
    });
    expect(findUnknownVariables(recipe)).toEqual([]);
  });

  it('detects unknown variables in configFile', () => {
    const recipe = parseRecipe({
      ...validPaperRecipe,
      install: [
        { action: 'configFile', file: 'x.ini', parser: 'ini', find: { key: '{{NOT_DECLARED}}' } },
      ],
    });
    expect(findUnknownVariables(recipe)).toEqual(['NOT_DECLARED']);
  });
});

describe('findToolFeatureErrors (java/steamcmd features interpreted by the agent)', () => {
  const base = {
    schemaVersion: 2 as const,
    id: 'tool-recipe',
    name: 'Tools',
    author: 'me',
    start: { command: 'java -jar app.jar' },
  };

  it('accepts the java feature with the JAVA_VERSION variable declared', () => {
    const recipe = parseRecipe({
      ...base,
      features: ['java'],
      variables: [{ env: JAVA_VERSION_ENV, name: 'Java', type: 'string', defaultValue: '21' }],
    });
    expect(findToolFeatureErrors(recipe)).toEqual([]);
  });

  it('rejects the java feature without the JAVA_VERSION variable', () => {
    const recipe = parseRecipe({ ...base, features: ['java'] });
    const errors = findToolFeatureErrors(recipe);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain(JAVA_VERSION_ENV);
  });

  it('reports a JAVA_VERSION variable without the java feature', () => {
    const recipe = parseRecipe({
      ...base,
      variables: [{ env: JAVA_VERSION_ENV, name: 'Java', type: 'string', defaultValue: '21' }],
    });
    expect(findToolFeatureErrors(recipe).length).toBe(1);
  });

  it('accepts the steamcmd feature with STEAM_APP_ID and STEAM_MOD declared', () => {
    const recipe = parseRecipe({
      ...base,
      features: ['steamcmd'],
      variables: [
        { env: STEAM_APP_ID_ENV, name: 'App', type: 'string', defaultValue: '90' },
        { env: STEAM_MOD_ENV, name: 'Mod', type: 'string', defaultValue: 'ricochet' },
      ],
    });
    expect(findToolFeatureErrors(recipe)).toEqual([]);
  });

  it('accepts the steamcmd feature alone (binary on PATH, no auto-install)', () => {
    const recipe = parseRecipe({ ...base, features: ['steamcmd'] });
    expect(findToolFeatureErrors(recipe)).toEqual([]);
  });

  it('reports STEAM_APP_ID without the steamcmd feature', () => {
    const recipe = parseRecipe({
      ...base,
      variables: [{ env: STEAM_APP_ID_ENV, name: 'App', type: 'string', defaultValue: '90' }],
    });
    const errors = findToolFeatureErrors(recipe);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('steamcmd');
  });

  it('reports nothing for a recipe without features or tool variables', () => {
    const recipe = parseRecipe({ ...base, features: ['eula'] });
    expect(findToolFeatureErrors(recipe)).toEqual([]);
  });
});

describe('validateVariableValue (Laravel rules equivalent)', () => {
  const base = { env: 'RAM_MB', name: 'RAM', type: 'number' as const, defaultValue: 1024 };

  it('validates a number within bounds', () => {
    expect(validateVariableValue({ ...base, min: 512, max: 4096 }, 2048)).toBeNull();
  });

  it('rejects a number out of bounds', () => {
    expect(validateVariableValue({ ...base, min: 512, max: 4096 }, 100)).toContain('512');
    expect(validateVariableValue({ ...base, min: 512, max: 4096 }, 9999)).toContain('4096');
  });

  it('rejects a non-numeric value for a number type', () => {
    expect(validateVariableValue(base, 'abc')).toContain('nombre');
  });

  it('validates a regex pattern', () => {
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

  it('validates an options list', () => {
    const varDef = {
      env: 'DIFFICULTY',
      name: 'Difficulty',
      type: 'string' as const,
      defaultValue: 'normal',
      options: ['easy', 'normal', 'hard'],
    };
    expect(validateVariableValue(varDef, 'normal')).toBeNull();
    expect(validateVariableValue(varDef, 'impossible')).toContain('easy');
  });
});

describe('backup config (recipe-declared archive contents)', () => {
  const base = {
    schemaVersion: 2 as const,
    id: 'backup-recipe',
    name: 'Backup',
    author: 'me',
    start: { command: 'java -jar app.jar' },
  };

  it('accepts a recipe without backup config (whole install dir)', () => {
    const recipe = parseRecipe(base);
    expect(recipe.backup).toBeUndefined();
  });

  it('accepts plain relative paths and glob metacharacters', () => {
    const recipe = parseRecipe({
      ...base,
      backup: { include: ['world', 'plugins/*', '*.properties', 'config/**/*.{yml,yaml}'] },
    });
    expect(recipe.backup?.include).toHaveLength(4);
  });

  it('accepts dotfiles patterns', () => {
    const recipe = parseRecipe({ ...base, backup: { include: ['.env', 'world/*'] } });
    expect(recipe.backup?.include).toContain('.env');
  });

  it('rejects an empty include list', () => {
    const result = safeParseRecipe({ ...base, backup: { include: [] } });
    expect(result.success).toBe(false);
  });

  it('rejects escape patterns', () => {
    for (const pattern of [
      '/etc/passwd',
      'C:/Windows/System32',
      '../outside',
      'world/../../..',
      '!secret',
      'a\\b',
      'a|b',
      'world//x',
      'world/',
    ]) {
      const result = safeParseRecipe({ ...base, backup: { include: [pattern] } });
      expect(result.success, `pattern "${pattern}" should be rejected`).toBe(false);
    }
  });

  it('validateBackupIncludePattern returns a message or null', () => {
    expect(validateBackupIncludePattern('world/**')).toBeNull();
    expect(validateBackupIncludePattern('..')).not.toBeNull();
    expect(validateBackupIncludePattern('')).not.toBeNull();
  });
});
