import { describe, it, expect } from 'vitest';

import { importEgg } from '../src/contract/egg-import';
import { parseRecipe } from '../src/contract/recipe-schema';

/** A minimal but realistic PTDL_v2 egg (paper-like Minecraft). */
const paperEgg = {
  meta: { version: 'PTDL_v2' },
  name: 'Paper',
  author: 'paper@example.com',
  description: 'High performance Spigot fork',
  features: ['failover', 'eula'],
  docker_images: {
    'ghcr.io/parkervcp/yolks:java_21': 'Java 21',
    'ghcr.io/parkervcp/yolks:java_17': 'Java 17',
  },
  update_url: 'https://example.com/egg.json',
  startup: 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}',
  stop: 'stop',
  config: {
    files: {
      'server.properties': {
        file: 'server.properties',
        parser: 'properties',
        find: [
          { path: 'server-port', text: '{{SERVER_PORT}}' },
          { path: 'motd', text: 'A Minecraft Server' },
        ],
      },
      'some.dat': {
        file: 'some.dat',
        parser: 'nothere',
        find: [{ path: 'key', text: 'value' }],
      },
    },
    startup: { done: 'Done \\([0-9.]+s\\)! For help', stripFrom: '\\[.*?\\] ' },
    logs: { custom: true, location: 'logs/latest.log' },
  },
  variables: [
    {
      name: 'Minecraft Version',
      env: 'MINECRAFT_VERSION',
      default_value: 'latest',
      user_viewable: true,
      user_editable: true,
      rules: 'required|string|max:20',
      sort: '0',
    },
    {
      name: 'Server Jar File',
      env: 'SERVER_JARFILE',
      default_value: 'server.jar',
      user_viewable: true,
      user_editable: true,
      rules: 'required|regex:/^([\\w\\d._-]+)(\\.jar)$/',
      sort: '1',
    },
    {
      name: 'Allocated RAM',
      env: 'RAM_MB',
      default_value: '1024',
      user_viewable: false,
      user_editable: false,
      rules: 'required|integer|min:512|max:65536',
      sort: '2',
    },
    {
      name: 'Difficulty',
      env: 'DIFFICULTY',
      default_value: 'normal',
      user_viewable: true,
      user_editable: true,
      rules: 'required|string|in:easy,normal,hard',
      sort: '3',
    },
  ],
};

describe('importEgg (PTDL_v2)', () => {
  it('maps an egg to a contract-valid recipe v3', () => {
    const { recipe } = importEgg(paperEgg);
    expect(() => parseRecipe(recipe)).not.toThrow();
    expect(recipe.schema_version).toBe(4);
    expect(recipe.id).toBe('paper');
    expect(recipe.name).toBe('Paper');
    expect(recipe.update_url).toBe('https://example.com/egg.json');
  });

  it('maps variables 1:1 with the recipe variable schema', () => {
    const { recipe } = importEgg(paperEgg);
    const byEnv = Object.fromEntries(recipe.variables.map((v) => [v.env, v]));

    expect(byEnv.MINECRAFT_VERSION).toMatchObject({
      name: 'Minecraft Version',
      default_value: 'latest',
      user_viewable: true,
      user_editable: true,
      max: 20,
      required: true,
    });
    expect(byEnv.SERVER_JARFILE.pattern).toBe('^([\\w\\d._-]+)(\\.jar)$');
    expect(byEnv.RAM_MB).toMatchObject({ type: 'number', min: 512, max: 65536 });
    expect(byEnv.DIFFICULTY.options).toEqual(['easy', 'normal', 'hard']);
  });

  it('maps startup, stop, ready and custom logs', () => {
    const { recipe } = importEgg(paperEgg);
    expect(recipe.start.command).toContain('{{SERVER_MEMORY}}');
    expect(recipe.start.stop).toEqual({ type: 'command', value: 'stop', timeout_ms: 30000 });
    expect(recipe.start.ready).toEqual({
      pattern: 'Done \\([0-9.]+s\\)! For help',
      strip: '\\[.*?\\] ',
    });
    expect(recipe.logs).toEqual({ mode: 'file', file: 'logs/latest.log', strip_ansi: true });
  });

  it('maps config.files entries to configFile actions and warns on unknown parsers', () => {
    const { recipe, warnings } = importEgg(paperEgg);
    const configFileAction = recipe.install.find((a) => a.action === 'configFile');
    expect(configFileAction).toMatchObject({
      file: 'server.properties',
      parser: 'properties',
      find: { 'server-port': '{{SERVER_PORT}}', motd: 'A Minecraft Server' },
    });
    expect(warnings.some((w) => w.includes('some.dat') && w.includes('parseur'))).toBe(true);
  });

  it('always warns about the ignored install scripts', () => {
    const { warnings } = importEgg(paperEgg);
    expect(warnings.some((w) => w.includes("scripts d'installation"))).toBe(true);
  });

  it('warns that the declared docker images are ignored (native model)', () => {
    const { recipe, warnings } = importEgg(paperEgg);
    expect(recipe).not.toHaveProperty('docker_image');
    expect(warnings.some((w) => w.includes('Images Docker'))).toBe(true);
  });

  it('warns about ignored features', () => {
    const { warnings } = importEgg(paperEgg);
    expect(warnings.some((w) => w.includes('failover'))).toBe(true);
  });

  it('imports an egg without any docker image (warning, not an error)', () => {
    const { docker_images: _i, ...noImage } = paperEgg;
    const { recipe, warnings } = importEgg(noImage);
    expect(recipe.id).toBeTruthy();
    expect(warnings.some((w) => w.toLowerCase().includes('docker'))).toBe(true);
  });

  it('throws on a non-PTDL_v2 version', () => {
    expect(() => importEgg({ ...paperEgg, meta: { version: 'PTDL_v1' } })).toThrow();
  });
});
