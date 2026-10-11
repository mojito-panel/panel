import { describe, it, expect } from 'vitest';
import { parseRecipe } from '@mojito/contract';
import { resolveVariables, render } from '../src/server/templating';
import type { SystemVariables } from '../src/server/templating';

const recipe = parseRecipe({
  schemaVersion: 2,
  id: 'test-recipe',
  name: 'Test',
  author: 'me',
  env: { JAVA_OPTS: '-XX:+UseG1GC' },
  variables: [
    { env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 },
    { env: 'SERVER_JARFILE', name: 'Jar', type: 'string', defaultValue: 'server.jar' },
  ],
  start: { command: 'java -Xmx{{RAM_MB}}M -jar {{SERVER_JARFILE}}' },
});

const systemVars: SystemVariables = {
  SERVER_UUID: '550e8400-e29b-41d4-a716-446655440000',
  SERVER_NAME: 'my-server',
  SERVER_MEMORY: 2048,
  SERVER_PORT: 25565,
  SERVER_IP: '0.0.0.0',
  SERVER_INSTALL_DIR: 'C:\\PanelData\\servers\\abc',
};

describe('resolveVariables', () => {
  it('resolves the recipe defaults', () => {
    const vars = resolveVariables(recipe, {}, systemVars);
    expect(vars.get('RAM_MB')).toBe('1024');
    expect(vars.get('SERVER_JARFILE')).toBe('server.jar');
  });

  it('resolves the recipe fixed env', () => {
    const vars = resolveVariables(recipe, {}, systemVars);
    expect(vars.get('JAVA_OPTS')).toBe('-XX:+UseG1GC');
  });

  it('server values override the defaults', () => {
    const vars = resolveVariables(recipe, { RAM_MB: 4096 }, systemVars);
    expect(vars.get('RAM_MB')).toBe('4096');
    expect(vars.get('SERVER_JARFILE')).toBe('server.jar');
  });

  it('system variables are always resolved', () => {
    const vars = resolveVariables(recipe, {}, systemVars);
    expect(vars.get('SERVER_MEMORY')).toBe('2048');
    expect(vars.get('SERVER_PORT')).toBe('25565');
    expect(vars.get('SERVER_UUID')).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(vars.get('SERVER_INSTALL_DIR')).toBe('C:\\PanelData\\servers\\abc');
  });

  it('system variables cannot be overridden by the server', () => {
    const vars = resolveVariables(recipe, { SERVER_MEMORY: 999999 }, systemVars);
    expect(vars.get('SERVER_MEMORY')).toBe('2048');
  });

  it('boolean and numeric values are converted to string', () => {
    const recipeBool = parseRecipe({
      schemaVersion: 2,
      id: 'test-bool',
      name: 'Test',
      author: 'me',
      variables: [{ env: 'DEBUG', name: 'Debug', type: 'boolean', defaultValue: true }],
      start: { command: 'echo {{DEBUG}}' },
    });
    const vars = resolveVariables(recipeBool, {}, systemVars);
    expect(vars.get('DEBUG')).toBe('true');
  });
});

describe('render', () => {
  it('replaces variables', () => {
    const vars = resolveVariables(recipe, { RAM_MB: 4096 }, systemVars);
    expect(render('java -Xmx{{RAM_MB}}M -jar {{SERVER_JARFILE}}', vars)).toBe(
      'java -Xmx4096M -jar server.jar',
    );
  });

  it('handles spaces inside the braces', () => {
    const vars = resolveVariables(recipe, {}, systemVars);
    expect(render('{{ RAM_MB }}', vars)).toBe('1024');
  });

  it('replaces system variables', () => {
    const vars = resolveVariables(recipe, {}, systemVars);
    expect(render('{{SERVER_MEMORY}}MB, port {{SERVER_PORT}}', vars)).toBe('2048MB, port 25565');
  });

  it('unknown variable = error', () => {
    const vars = resolveVariables(recipe, {}, systemVars);
    expect(() => render('{{UNKNOWN_VAR}}', vars)).toThrow('UNKNOWN_VAR');
  });

  it('string without variables is unchanged', () => {
    const vars = resolveVariables(recipe, {}, systemVars);
    expect(render('plain text 100%', vars)).toBe('plain text 100%');
  });

  it('lowercase templates are ignored (not variables)', () => {
    const vars = resolveVariables(recipe, {}, systemVars);
    expect(render('{{lowercase}}', vars)).toBe('{{lowercase}}');
  });
});
