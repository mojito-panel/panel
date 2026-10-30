import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  recipeSchema,
  recipeVariableSchema,
  parseRecipe,
  safeParseRecipe,
  extractTemplateVars,
  findUnknownVariables,
  validateVariableValue,
  validateBackupIncludePattern,
  type RecipeVariable,
} from '../src/contract/recipe-schema';

/**
 * Fixture variables omit the fields the schema defaults at parse time
 * (`user_viewable`, `user_editable`, `sort`, `required`) — the helper's
 * parameter is the PARSED output type, so partial fixtures cross it with a
 * type-level cast only (the helper never reads the defaulted fields).
 */
type VariableFixture = z.input<typeof recipeVariableSchema>;
const asVariable = (variable: VariableFixture): RecipeVariable => variable as RecipeVariable;

/**
 * Paper-style egg — covers all recipe v3 features:
 * UPPERCASE env variables, system variables, configFile parser,
 * ready detection with strip, logs, fixed env.
 */
const validPaperRecipe = {
  schema_version: 4 as const,
  id: 'minecraft-paper',
  name: 'Paper',
  author: 'papermc',
  description: 'High performance Spigot fork.',
  tags: ['minecraft', 'java'],
  variables: [
    {
      env: 'MINECRAFT_VERSION',
      name: 'Minecraft Version',
      type: 'string' as const,
      default_value: 'latest',
      user_viewable: true,
      user_editable: true,
      sort: 0,
      required: true,
    },
    {
      env: 'SERVER_JARFILE',
      name: 'Server Jar File',
      type: 'string' as const,
      default_value: 'server.jar',
      user_viewable: true,
      user_editable: true,
      sort: 1,
      required: true,
      pattern: '^([\\w\\d._-]+)(\\.jar)$',
    },
    {
      env: 'BUILD_NUMBER',
      name: 'Build Number',
      type: 'string' as const,
      default_value: 'latest',
      user_viewable: false,
      user_editable: false,
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
    stop: { type: 'command' as const, value: 'stop', timeout_ms: 30000 },
    ready: { pattern: 'Done \\([0-9.]+s\\)! For help', strip: '\\[.*?\\] ' },
    configs: [
      {
        file: 'server.properties',
        parser: 'properties' as const,
        find: { 'server-port': '{{SERVER_PORT}}' },
      },
    ],
  },
  logs: { mode: 'stdout' as const, strip_ansi: true },
  env: { JAVA_OPTS: '-XX:+UseG1GC' },
};

describe('recipeSchema', () => {
  it('validates a complete Paper egg', () => {
    const result = recipeSchema.safeParse(validPaperRecipe);
    expect(result.success).toBe(true);
  });

  it('rejects an incorrect schema_version', () => {
    const result = recipeSchema.safeParse({ ...validPaperRecipe, schema_version: 2 });
    expect(result.success).toBe(false);
  });

  it('strips the legacy docker image fields (v4 is native)', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      docker_image: 'ghcr.io/mojito/windows-jdk21:latest',
      docker_images: { Java17: 'img:17' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('docker_image');
      expect(result.data).not.toHaveProperty('docker_images');
    }
  });

  it('rejects an id with invalid characters', () => {
    const result = recipeSchema.safeParse({ ...validPaperRecipe, id: 'Minecraft Paper!' });
    expect(result.success).toBe(false);
  });

  it('rejects a variable with a lowercase env name', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      variables: [{ env: 'version', name: 'Version', type: 'string', default_value: 'latest' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variable using a reserved system name', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      variables: [{ env: 'SERVER_MEMORY', name: 'RAM', type: 'number', default_value: 1024 }],
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

  it('rejects a bash script (Windows shells only)', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      install: [{ action: 'script', shell: 'bash', content: 'echo hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a variable with a duplicated env', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      variables: [
        { env: 'MINECRAFT_VERSION', name: 'V1', type: 'string', default_value: 'a' },
        { env: 'MINECRAFT_VERSION', name: 'V2', type: 'string', default_value: 'b' },
      ],
    });
    // No uniqueness constraint at the Zod level (checked by the panel on import)
    expect(result.success).toBe(true);
  });

  it('accepts a minimal recipe (no install, no variables)', () => {
    const minimal = {
      schema_version: 4 as const,
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
        expect(result.data.start.stop?.timeout_ms).toBe(30000);
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

  it('rejects a signal stop with the removed WM_CLOSE lever', () => {
    // WM_CLOSE was removed from the contract and the agent: a dedicated-user
    // (batch logon) tree owns no window station, so a GUI-subsystem server
    // never creates a window and the lever had nothing to close.
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      start: { ...validPaperRecipe.start, stop: { type: 'signal', value: 'WM_CLOSE' } },
    });
    expect(result.success).toBe(false);
  });

  it('applies Pelican-style defaults to variables', () => {
    const result = recipeSchema.safeParse({
      ...validPaperRecipe,
      variables: [{ env: 'SIMPLE', name: 'Simple', type: 'string', default_value: 'x' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const v = result.data.variables[0];
      expect(v.user_viewable).toBe(true);
      expect(v.user_editable).toBe(true);
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

  it('detects unknown variables in the pre-start configs', () => {
    const recipe = parseRecipe({
      ...validPaperRecipe,
      start: {
        ...validPaperRecipe.start,
        configs: [{ file: 'x.ini', parser: 'ini', find: { key: '{{MISSING}}' } }],
      },
    });
    expect(findUnknownVariables(recipe)).toEqual(['MISSING']);
  });
});

describe('pre-start configs (start.configs)', () => {
  it('leaves the list absent when the recipe declares none', () => {
    const recipe = parseRecipe({
      ...validPaperRecipe,
      start: { ...validPaperRecipe.start, configs: undefined },
    });
    expect(recipe.start.configs).toBeUndefined();
  });

  it('accepts one entry per file with its parser and keys', () => {
    const recipe = parseRecipe(validPaperRecipe);
    expect(recipe.start.configs).toEqual([
      {
        file: 'server.properties',
        parser: 'properties',
        find: { 'server-port': '{{SERVER_PORT}}' },
      },
    ]);
  });

  it('rejects an unknown parser', () => {
    const result = safeParseRecipe({
      ...validPaperRecipe,
      start: {
        ...validPaperRecipe.start,
        configs: [{ file: 'x.toml', parser: 'toml', find: { a: 'b' } }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entry without a file', () => {
    const result = safeParseRecipe({
      ...validPaperRecipe,
      start: {
        ...validPaperRecipe.start,
        configs: [{ file: '', parser: 'ini', find: { a: 'b' } }],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('requirements (removed from the contract)', () => {
  it('ignores a legacy requirements block instead of rejecting the recipe', () => {
    const result = safeParseRecipe({
      ...validPaperRecipe,
      requirements: { min_ram_mb: 1024, required_commands: ['java'] },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('requirements');
  });
});

describe('validateVariableValue (Laravel rules equivalent)', () => {
  const base = { env: 'RAM_MB', name: 'RAM', type: 'number' as const, default_value: 1024 };

  it('validates a number within bounds', () => {
    expect(validateVariableValue(asVariable({ ...base, min: 512, max: 4096 }), 2048)).toBeNull();
  });

  it('rejects a number out of bounds', () => {
    expect(validateVariableValue(asVariable({ ...base, min: 512, max: 4096 }), 100)).toContain(
      '512',
    );
    expect(validateVariableValue(asVariable({ ...base, min: 512, max: 4096 }), 9999)).toContain(
      '4096',
    );
  });

  it('rejects a non-numeric value for a number type', () => {
    expect(validateVariableValue(asVariable(base), 'abc')).toContain('nombre');
  });

  it('validates a regex pattern', () => {
    const varDef = {
      env: 'JAR',
      name: 'Jar',
      type: 'string' as const,
      default_value: 'server.jar',
      pattern: /^([\w\d._-]+)(\.jar)$/.source,
    };
    expect(validateVariableValue(asVariable(varDef), 'server.jar')).toBeNull();
    expect(validateVariableValue(asVariable(varDef), 'server.txt')).toContain('format');
  });

  it('validates an options list', () => {
    const varDef = {
      env: 'DIFFICULTY',
      name: 'Difficulty',
      type: 'string' as const,
      default_value: 'normal',
      options: ['easy', 'normal', 'hard'],
    };
    expect(validateVariableValue(asVariable(varDef), 'normal')).toBeNull();
    expect(validateVariableValue(asVariable(varDef), 'impossible')).toContain('easy');
  });
});

describe('backup config (recipe-declared archive contents)', () => {
  const base = {
    schema_version: 4 as const,
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
