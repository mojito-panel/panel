import { describe, it, expect } from 'vitest';
import { parsePlugin } from '@mojito/contract';
import { resolveVariables, render } from '../src/server/templating';
import type { SystemVariables } from '../src/server/templating';

const plugin = parsePlugin({
  schemaVersion: 2,
  id: 'test-plugin',
  name: 'Test',
  author: 'moi',
  env: { JAVA_OPTS: '-XX:+UseG1GC' },
  variables: [
    { env: 'RAM_MB', name: 'RAM', type: 'number', defaultValue: 1024 },
    { env: 'SERVER_JARFILE', name: 'Jar', type: 'string', defaultValue: 'server.jar' },
  ],
  start: { command: 'java -Xmx{{RAM_MB}}M -jar {{SERVER_JARFILE}}' },
});

const systemVars: SystemVariables = {
  SERVER_UUID: '550e8400-e29b-41d4-a716-446655440000',
  SERVER_NAME: 'mon-serveur',
  SERVER_MEMORY: 2048,
  SERVER_PORT: 25565,
  SERVER_IP: '0.0.0.0',
  SERVER_INSTALL_DIR: 'C:\\PanelData\\servers\\abc',
};

describe('resolveVariables', () => {
  it('résout les defaults du plugin', () => {
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(vars.get('RAM_MB')).toBe('1024');
    expect(vars.get('SERVER_JARFILE')).toBe('server.jar');
  });

  it('résout le env fixe du plugin', () => {
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(vars.get('JAVA_OPTS')).toBe('-XX:+UseG1GC');
  });

  it('les valeurs du serveur écrasent les defaults', () => {
    const vars = resolveVariables(plugin, { RAM_MB: 4096 }, systemVars);
    expect(vars.get('RAM_MB')).toBe('4096');
    expect(vars.get('SERVER_JARFILE')).toBe('server.jar');
  });

  it('les variables système sont toujours résolues', () => {
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(vars.get('SERVER_MEMORY')).toBe('2048');
    expect(vars.get('SERVER_PORT')).toBe('25565');
    expect(vars.get('SERVER_UUID')).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(vars.get('SERVER_INSTALL_DIR')).toBe('C:\\PanelData\\servers\\abc');
  });

  it('les variables système ne sont pas surchargeables par le serveur', () => {
    const vars = resolveVariables(plugin, { SERVER_MEMORY: 999999 }, systemVars);
    expect(vars.get('SERVER_MEMORY')).toBe('2048');
  });

  it('les valeurs booléennes et numériques sont converties en string', () => {
    const pluginBool = parsePlugin({
      schemaVersion: 2,
      id: 'test-bool',
      name: 'Test',
      author: 'moi',
      variables: [{ env: 'DEBUG', name: 'Debug', type: 'boolean', defaultValue: true }],
      start: { command: 'echo {{DEBUG}}' },
    });
    const vars = resolveVariables(pluginBool, {}, systemVars);
    expect(vars.get('DEBUG')).toBe('true');
  });
});

describe('render', () => {
  it('remplace les variables', () => {
    const vars = resolveVariables(plugin, { RAM_MB: 4096 }, systemVars);
    expect(render('java -Xmx{{RAM_MB}}M -jar {{SERVER_JARFILE}}', vars)).toBe(
      'java -Xmx4096M -jar server.jar',
    );
  });

  it('gère les espaces dans les accolades', () => {
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(render('{{ RAM_MB }}', vars)).toBe('1024');
  });

  it('remplace les variables système', () => {
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(render('{{SERVER_MEMORY}}Mo, port {{SERVER_PORT}}', vars)).toBe('2048Mo, port 25565');
  });

  it('variable inconnue = erreur', () => {
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(() => render('{{UNKNOWN_VAR}}', vars)).toThrow('UNKNOWN_VAR');
  });

  it('chaîne sans variables est inchangée', () => {
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(render('plain text 100%', vars)).toBe('plain text 100%');
  });

  it('les templates lowercase sont ignorés (pas des variables)', () => {
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(render('{{lowercase}}', vars)).toBe('{{lowercase}}');
  });
});
