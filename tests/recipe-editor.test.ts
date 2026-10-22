import { describe, it, expect } from 'vitest';
import { parseRecipe, safeParseRecipe } from '~/contract';
import {
  emptyRecipeEditorValue,
  newActionValue,
  newVariableValue,
  recipeEditorValueToRecipe,
  recipeToEditorValue,
  findUnknownVariablesInEditorValue,
  recipeEditorSchema,
  type RecipeEditorValue,
} from '~/validators/recipe-editor';

/** A complete, valid editor value (Java Minecraft-like recipe). */
function fullEditorValue(): RecipeEditorValue {
  return {
    id: 'my-recipe',
    recipeType: 'app',
    name: 'My recipe',
    author: 'steader@example.com',
    description: 'A test recipe',
    tags: ['minecraft'],
    updateUrl: 'https://example.com/recipe.json',
    requires: ['java'],
    exportPath: true,
    exportEnv: [],
    requirements: { minRamMb: 1024, minDiskMb: 0, minCpuPercent: 0, requiredCommands: [] },
    env: [{ key: 'SERVER_JARFILE', value: 'server.jar' }],
    backup: { include: ['world', 'plugins/*', 'server.properties'] },
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
        ...newActionValue('script'),
        action: 'script' as const,
        shell: 'powershell' as const,
        content: 'Write-Output "{{SERVER_NAME}}"',
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
      command: 'java -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui',
      stop: { type: 'command', value: 'stop', timeoutMs: 30000 },
      ready: { pattern: 'Done \\([0-9.]+s\\)!', strip: '' },
      workingDirectory: '',
    },
    logs: { mode: 'stdout', file: '', stripAnsi: true },
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

  it('rejects a missing start command', () => {
    const value = fullEditorValue();
    value.start = { ...value.start, command: '' };
    expect(recipeEditorSchema.safeParse(value).success).toBe(false);
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
    expect(recipe?.update_url).toBeUndefined();
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

  it('always emits a v4 recipe without any docker image', () => {
    const { recipe } = recipeEditorValueToRecipe(fullEditorValue());
    expect(recipe?.schema_version).toBe(4);
    expect(recipe).not.toHaveProperty('docker_image');
  });
});

describe('findUnknownVariablesInEditorValue', () => {
  it('returns nothing when all templates are declared', () => {
    expect(findUnknownVariablesInEditorValue(fullEditorValue())).toEqual([]);
  });

  it('detects an undeclared template variable', () => {
    const value = fullEditorValue();
    value.start.command = 'java -jar {{UNDECLARED_VAR}}';
    expect(findUnknownVariablesInEditorValue(value)).toEqual(['UNDECLARED_VAR']);
  });

  it('accepts system variables without declaration', () => {
    const value = fullEditorValue();
    value.start.command = 'java -jar {{SERVER_JARFILE}} {{SERVER_MEMORY}}';
    expect(findUnknownVariablesInEditorValue(value)).toEqual([]);
  });
});
