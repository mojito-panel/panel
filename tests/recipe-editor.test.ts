import { describe, it, expect } from 'vitest';
import { parseRecipe, parseRuntimeRecipe, safeParseRecipe } from '~/contract';
import {
  emptyRecipeEditorValue,
  emptyRuntimeEditorValue,
  newActionValue,
  newVariableValue,
  recipeEditorValueToRecipe,
  recipeToEditorValue,
  runtimeEditorSchema,
  runtimeEditorValueToRecipe,
  runtimeRecipeToEditorValue,
  findUnknownVariablesInEditorValue,
  recipeEditorSchema,
  type RecipeEditorValue,
} from '~/validators/recipe-editor';

/** A complete, valid editor value (Java Minecraft-like recipe). */
function fullEditorValue(): RecipeEditorValue {
  return {
    id: 'my-recipe',
    name: 'My recipe',
    author: 'steader@example.com',
    description: 'A test recipe',
    tags: ['minecraft'],
    requires: [],
    updateUrl: 'https://example.com/recipe.json',
    requirements: { minRamMb: 1024, minDiskMb: 0, minCpuPercent: 0, requiredCommands: ['java'] },
    env: [{ key: 'SERVER_JARFILE', value: 'server.jar' }],
    backup: { include: ['world', 'plugins/*', 'server.properties'] },
    exportPath: true,
    exportEnv: [],
    variables: [
      {
        ...newVariableValue(0),
        name: 'Version',
        env: 'MINECRAFT_VERSION',
        type: 'string',
        defaultValue: '1.21',
        options: ['1.20.4', '1.21'],
        pattern: '^[0-9.]+$',
      },
      {
        ...newVariableValue(1),
        name: 'Memory',
        env: 'SERVER_MEMORY_OVERRIDE',
        type: 'number',
        defaultValue: 2048,
        min: 512,
        max: 8192,
      },
    ],
    install: [
      {
        ...newActionValue('download'),
        action: 'download',
        url: 'https://example.com/mc-{{MINECRAFT_VERSION}}.jar',
        dest: 'server.jar',
        checksum: 'abc',
        headers: [{ key: 'X-Test', value: '1' }],
      },
      {
        ...newActionActionValue(),
      },
      {
        ...newActionValue('configFile'),
        action: 'configFile',
        file: 'server.properties',
        parser: 'properties',
        configFind: [{ key: 'server-port', value: '{{SERVER_PORT}}' }],
      },
    ],
    start: {
      command: '.bin/java -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui',
      stop: { type: 'command', value: 'stop', timeoutMs: 30000 },
      ready: { pattern: 'Done \\([0-9.]+s\\)!', strip: '' },
      workingDirectory: '',
    },
    logs: { mode: 'stdout', file: '', stripAnsi: true },
  };
}

/** `script` action built via newActionValue (helper for the union of shapes). */
function newActionActionValue() {
  return {
    ...newActionValue('script'),
    action: 'script' as const,
    shell: 'powershell' as const,
    content: 'Write-Output "{{SERVER_NAME}}"',
  };
}

describe('recipe editor schema', () => {
  it('accepts a complete editor value', () => {
    const result = recipeEditorSchema.safeParse(fullEditorValue());
    expect(result.success).toBe(true);
  });

  it('rejects an empty editor value (required fields)', () => {
    const result = recipeEditorSchema.safeParse(emptyRecipeEditorValue());
    expect(result.success).toBe(false);
  });

  it('rejects a reserved or lowercase variable env name', () => {
    const value = fullEditorValue();
    value.variables = [{ ...value.variables[0], env: 'server_port' }];
    expect(recipeEditorSchema.safeParse(value).success).toBe(false);

    value.variables = [{ ...value.variables[0], env: 'SERVER_UUID' }];
    expect(recipeEditorSchema.safeParse(value).success).toBe(false);
  });

  it('rejects duplicate variable envs with an error on each duplicate', () => {
    const value = fullEditorValue();
    value.variables = [
      { ...value.variables[0], env: 'MINECRAFT_VERSION' },
      { ...value.variables[1], env: 'MINECRAFT_VERSION' },
    ];
    const result = recipeEditorSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('variables.0.env');
      expect(paths).toContain('variables.1.env');
    }
  });

  it('rejects an install action missing its type-specific required fields', () => {
    const value = fullEditorValue();
    value.install = [newActionValue('download')];
    expect(recipeEditorSchema.safeParse(value).success).toBe(false);
  });
});

describe('recipeEditorValueToRecipe', () => {
  it('converts a valid editor value into a contract-valid recipe', () => {
    const { recipe, issues } = recipeEditorValueToRecipe(fullEditorValue());
    expect(issues).toBeUndefined();
    expect(recipe).toBeDefined();
    // The produced recipe passes the CONTRACT schema (server-side check)
    expect(safeParseRecipe(recipe).success).toBe(true);
    expect(recipe?.variables).toHaveLength(2);
    expect(recipe?.variables[0].options).toEqual(['1.20.4', '1.21']);
    expect(recipe?.variables[1].min).toBe(512);
    expect(recipe?.env).toEqual({ SERVER_JARFILE: 'server.jar' });
    expect(recipe?.install).toHaveLength(3);
    expect(recipe?.install[0]).toMatchObject({
      action: 'download',
      headers: { 'X-Test': '1' },
    });
  });

  it('reports issues instead of a recipe when the contract rejects the value', () => {
    const value = fullEditorValue();
    value.id = 'UPPER CASE'; // invalid slug for the contract
    const { recipe, issues } = recipeEditorValueToRecipe(value);
    expect(recipe).toBeUndefined();
    expect(issues?.length).toBeGreaterThan(0);
  });

  it('omits empty fields (description, stop, ready…)', () => {
    const value = fullEditorValue();
    value.description = '';
    value.updateUrl = '';
    value.start.stop = null;
    value.start.ready = null;
    const { recipe } = recipeEditorValueToRecipe(value);
    expect(recipe?.description).toBeUndefined();
    expect(recipe?.updateUrl).toBeUndefined();
    expect(recipe?.start.stop).toBeUndefined();
    expect(recipe?.start.ready).toBeUndefined();
  });

  it('round-trips through recipeToEditorValue without loss', () => {
    const value = fullEditorValue();
    const { recipe } = recipeEditorValueToRecipe(value);
    const parsed = parseRecipe(recipe!);
    const back = recipeToEditorValue(parsed);
    expect(recipeEditorValueToRecipe(back).recipe).toEqual(recipe);
  });

  it('carries the backup include patterns to the recipe JSON', () => {
    const { recipe } = recipeEditorValueToRecipe(fullEditorValue());
    expect(recipe?.backup?.include).toEqual(['world', 'plugins/*', 'server.properties']);
  });

  it('drops the backup section when the include list is empty', () => {
    const value = fullEditorValue();
    value.backup = { include: [] };
    const { recipe } = recipeEditorValueToRecipe(value);
    expect(recipe?.backup).toBeUndefined();
  });

  it('rejects an escaping backup include pattern in the schema', () => {
    const value = fullEditorValue();
    value.backup = { include: ['../secrets'] };
    const result = recipeEditorSchema.safeParse(value);
    expect(result.success).toBe(false);
  });

  it('carries the required runtimes to the recipe JSON', () => {
    const value = fullEditorValue();
    value.requires = ['java'];
    value.variables.push({
      ...newVariableValue(2),
      name: 'Java',
      env: 'JAVA_VERSION',
      type: 'string',
      defaultValue: '21',
    });
    const { recipe, issues } = recipeEditorValueToRecipe(value);
    expect(issues).toBeUndefined();
    expect(recipe?.schemaVersion).toBe(1);
    expect(recipe?.type).toBe('app');
    expect(recipe?.requires).toEqual(['java']);
    // The produced recipe passes the CONTRACT schema (server-side check)
    expect(safeParseRecipe(recipe!).success).toBe(true);
  });

  it('always emits a v1 app recipe', () => {
    const { recipe } = recipeEditorValueToRecipe(fullEditorValue());
    expect(recipe?.schemaVersion).toBe(1);
    expect(recipe?.type).toBe('app');
  });

  it('round-trips a recipe with requires through the editor value', () => {
    const value = fullEditorValue();
    value.requires = ['java'];
    value.variables.push({
      ...newVariableValue(2),
      name: 'Java',
      env: 'JAVA_VERSION',
      type: 'string',
      defaultValue: '21',
    });
    const { recipe } = recipeEditorValueToRecipe(value);
    const back = recipeToEditorValue(parseRecipe(recipe!));
    expect(recipeEditorValueToRecipe(back).recipe).toEqual(recipe);
  });

  it('rejects an invalid runtime id in the schema', () => {
    const value = fullEditorValue();
    value.requires = ['Bad ID'];
    expect(recipeEditorSchema.safeParse(value).success).toBe(false);
  });

  it('rejects a duplicate runtime id in the schema', () => {
    const value = fullEditorValue();
    value.requires = ['java', 'java'];
    expect(recipeEditorSchema.safeParse(value).success).toBe(false);
  });
});

describe('findUnknownVariablesInEditorValue', () => {
  it('returns nothing when all templates are declared', () => {
    expect(findUnknownVariablesInEditorValue(fullEditorValue())).toEqual([]);
  });

  it('detects an undeclared template variable', () => {
    const value = fullEditorValue();
    value.start.command = '.bin/java -jar {{UNDeclared_VAR}}';
    // {{UNDeclared_VAR}} contains a lowercase segment — not a valid UPPERCASE template
    value.start.command = '.bin/java -jar {{UNDECLARED_VAR}}';
    expect(findUnknownVariablesInEditorValue(value)).toEqual(['UNDECLARED_VAR']);
  });

  it('accepts system variables without declaration', () => {
    const value = fullEditorValue();
    value.start.command = '.bin/java -jar {{SERVER_JARFILE}} {{SERVER_MEMORY}}';
    expect(findUnknownVariablesInEditorValue(value)).toEqual([]);
  });
});

/** A complete, valid runtime editor value (java runtime-like). */
function runtimeEditorValue(): RecipeEditorValue {
  const value = fullEditorValue();
  value.id = 'java';
  value.tags = ['java', 'jdk', 'runtime'];
  value.requires = [];
  value.variables = [
    {
      ...newVariableValue(0),
      name: 'JDK',
      env: 'JAVA_VERSION',
      type: 'string',
      defaultValue: '21',
      options: ['11', '17', '21'],
    },
  ];
  value.install = [
    {
      ...newActionValue('download'),
      action: 'download',
      url: 'https://aka.ms/jdk-{{JAVA_VERSION}}.zip',
      dest: 'jdk.zip',
    },
    {
      ...newActionValue('extract'),
      action: 'extract',
      archive: 'jdk.zip',
      dest: '.',
      stripComponents: 1,
    },
  ];
  value.exportPath = true;
  value.exportEnv = [{ key: 'JAVA_HOME', value: '{{RUNTIME_DIR}}' }];
  return value;
}

describe('runtimeEditorValueToRecipe', () => {
  it('converts a valid editor value into a contract-valid runtime recipe', () => {
    const { recipe, issues } = runtimeEditorValueToRecipe(runtimeEditorValue());
    expect(issues).toBeUndefined();
    expect(recipe).toBeDefined();
    expect(recipe?.schemaVersion).toBe(1);
    expect(recipe?.type).toBe('runtime');
    expect(recipe?.export?.path).toBe(true);
    expect(recipe?.export?.env).toEqual({ JAVA_HOME: '{{RUNTIME_DIR}}' });
    // The produced recipe passes the CONTRACT runtime schema (server-side check)
    expect(() => parseRuntimeRecipe(recipe!)).not.toThrow();
  });

  it('drops the app-only fields (start, logs, backup are not part of a runtime)', () => {
    const { recipe } = runtimeEditorValueToRecipe(runtimeEditorValue());
    expect(recipe).not.toHaveProperty('start');
    expect(recipe).not.toHaveProperty('logs');
    expect(recipe).not.toHaveProperty('backup');
  });

  it('round-trips through runtimeRecipeToEditorValue without loss', () => {
    const { recipe } = runtimeEditorValueToRecipe(runtimeEditorValue());
    const back = runtimeRecipeToEditorValue(parseRuntimeRecipe(recipe!));
    expect(runtimeEditorValueToRecipe(back).recipe).toEqual(recipe);
  });

  it('reports issues instead of a recipe when the contract rejects the value', () => {
    const value = runtimeEditorValue();
    value.id = 'UPPER CASE'; // invalid slug for the contract
    const { recipe, issues } = runtimeEditorValueToRecipe(value);
    expect(recipe).toBeUndefined();
    expect(issues?.length).toBeGreaterThan(0);
  });
});

describe('runtimeEditorSchema', () => {
  it('rejects an empty runtime editor value (required fields)', () => {
    const result = runtimeEditorSchema.safeParse(emptyRuntimeEditorValue());
    expect(result.success).toBe(false);
  });

  it('accepts a complete runtime editor value (no start command required)', () => {
    const value = runtimeEditorValue();
    // The runtime form value carries empty app fields — they must not block it
    expect(runtimeEditorSchema.safeParse(value).success).toBe(true);
  });

  it('rejects a duplicate export env key', () => {
    const value = runtimeEditorValue();
    value.exportEnv = [
      { key: 'JAVA_HOME', value: 'a' },
      { key: 'JAVA_HOME', value: 'b' },
    ];
    expect(runtimeEditorSchema.safeParse(value).success).toBe(false);
  });
});
