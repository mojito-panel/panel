import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import AdmZip from 'adm-zip';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  JAVA_VERSION_ENV,
  STEAM_APP_ID_ENV,
  STEAM_MOD_ENV,
  parsePlugin,
  type PluginInput,
} from '@mojito/contract';
import { resolveVariables, type SystemVariables } from '../src/server/templating';
import { runInstall, type InstallEvent } from '../src/server/installer';
import { ensureTool, toolInstallDir, type ResolvedPluginTool } from '../src/tools/registry';
import {
  buildToolEnv,
  countToolSteps,
  ensurePluginTools,
  resolvePluginTools,
} from '../src/tools';

/**
 * Tool features (java, steamcmd) — prebuilt by the agent inside the
 * server's `.bin/`, injected into PATH, steamcmd content install included.
 */

let tmpRoot: string;
let httpServer: ReturnType<typeof createServer>;
let httpPort: number;

const systemVars: SystemVariables = {
  SERVER_UUID: '550e8400-e29b-41d4-a716-446655440000',
  SERVER_NAME: 'test-server',
  SERVER_MEMORY: 2048,
  SERVER_PORT: 25565,
  SERVER_IP: '0.0.0.0',
  SERVER_INSTALL_DIR: '',
};

function makePlugin(overrides: Partial<PluginInput> = {}) {
  return parsePlugin({
    schemaVersion: 2,
    id: 'tool-plugin',
    name: 'Tools',
    author: 'moi',
    install: [],
    start: { command: 'echo ok' },
    ...overrides,
  });
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mojito-tools-'));
  systemVars.SERVER_INSTALL_DIR = tmpRoot;

  // Fake tool zips served locally (no aka.ms / Steam CDN in tests)
  const jdkZip = new AdmZip();
  jdkZip.addFile('jdk-21.0.0/bin/java.exe', Buffer.from('fake-jdk'));
  const steamcmdZip = new AdmZip();
  steamcmdZip.addFile('steamcmd.exe', Buffer.from('fake-steamcmd'));

  httpServer = createServer((req, res) => {
    if (req.url === '/jdk.zip') {
      res.writeHead(200, { 'content-type': 'application/zip' });
      res.end(jdkZip.toBuffer());
    } else if (req.url === '/steamcmd.zip') {
      res.writeHead(200, { 'content-type': 'application/zip' });
      res.end(steamcmdZip.toBuffer());
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  httpPort = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

// ─── resolvePluginTools (features → tools, params from variables) ──────────

describe('resolvePluginTools', () => {
  it('feature java → JDK dont la version vient de JAVA_VERSION', () => {
    const plugin = makePlugin({
      features: ['java'],
      variables: [
        { env: JAVA_VERSION_ENV, name: 'Java', type: 'string', defaultValue: '21' },
      ],
    });
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(resolvePluginTools(plugin, vars)).toEqual([
      { name: 'java', key: '21', label: 'java 21' },
    ]);
  });

  it('la valeur serveur surcharge la version (JAVA_VERSION = 17)', () => {
    const plugin = makePlugin({
      features: ['java'],
      variables: [
        { env: JAVA_VERSION_ENV, name: 'Java', type: 'string', defaultValue: '21' },
      ],
    });
    const vars = resolveVariables(plugin, { [JAVA_VERSION_ENV]: '17' }, systemVars);
    expect(resolvePluginTools(plugin, vars)[0].key).toBe('17');
  });

  it('feature java sans valeur JAVA_VERSION → erreur claire', () => {
    const plugin = makePlugin({ features: ['java'] });
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(() => resolvePluginTools(plugin, vars)).toThrow(JAVA_VERSION_ENV);
  });

  it('feature steamcmd avec STEAM_APP_ID et STEAM_MOD → content install paramétré', () => {
    const plugin = makePlugin({
      features: ['steamcmd'],
      variables: [
        { env: STEAM_APP_ID_ENV, name: 'App', type: 'string', defaultValue: '90' },
        { env: STEAM_MOD_ENV, name: 'Mod', type: 'string', defaultValue: 'ricochet' },
      ],
    });
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(resolvePluginTools(plugin, vars)).toEqual([
      { name: 'steamcmd', key: '', label: 'steamcmd', steamcmd: { appId: '90', mod: 'ricochet' } },
    ]);
  });

  it('feature steamcmd sans STEAM_APP_ID → binaire sur le PATH uniquement', () => {
    const plugin = makePlugin({ features: ['steamcmd'] });
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(resolvePluginTools(plugin, vars)).toEqual([
      { name: 'steamcmd', key: '', label: 'steamcmd', steamcmd: undefined },
    ]);
  });

  it('aucune feature outil → aucun outil', () => {
    const plugin = makePlugin({ features: ['eula'] });
    const vars = resolveVariables(plugin, {}, systemVars);
    expect(resolvePluginTools(plugin, vars)).toEqual([]);
  });
});

// ─── countToolSteps ──────────────────────────────────────────────────────────

describe('countToolSteps', () => {
  it('compte les étapes des features outils (ensure + 2 passes steamcmd)', () => {
    const javaOnly = makePlugin({
      features: ['java'],
      variables: [{ env: JAVA_VERSION_ENV, name: 'v', type: 'string', defaultValue: '21' }],
    });
    expect(countToolSteps(javaOnly)).toBe(1);

    const steamWithApp = makePlugin({
      features: ['steamcmd'],
      variables: [{ env: STEAM_APP_ID_ENV, name: 'app', type: 'string', defaultValue: '90' }],
    });
    expect(countToolSteps(steamWithApp)).toBe(3); // ensure + app_update + validate

    const steamBare = makePlugin({ features: ['steamcmd'] });
    expect(countToolSteps(steamBare)).toBe(1);

    expect(countToolSteps(makePlugin())).toBe(0);
  });
});

// ─── ensureTool (per-server .bin, idempotent, marker) ─────────────────────────

/** Fresh server directory per test (isolation of the per-server `.bin/`). */
const newServerDir = () => join(tmpRoot, `srv-${Math.random().toString(36).slice(2)}`);

describe('ensureTool', () => {
  const installDir = newServerDir;
  it('télécharge le JDK dans <installDir>/.bin/java (stripComponents, JAVA_HOME)', async () => {
    if (process.platform !== 'win32') return;
    const dir = installDir();
    const result = await ensureTool(
      { name: 'java', key: '21', label: 'java 21' },
      { installDir: dir, downloadUrl: `http://127.0.0.1:${httpPort}/jdk.zip` },
    );
    expect(result.installed).toBe(true);
    expect(result.binDir).toBe(join(dir, '.bin', 'java', 'bin'));
    expect(result.env.JAVA_HOME).toBe(join(dir, '.bin', 'java'));
    await access(join(dir, '.bin', 'java', 'bin', 'java.exe'));
  });

  it('est idempotent : marker présent → pas de re-téléchargement', async () => {
    if (process.platform !== 'win32') return;
    const dir = installDir();
    const tool: ResolvedPluginTool = { name: 'java', key: '21', label: 'java 21' };
    const options = { installDir: dir, downloadUrl: `http://127.0.0.1:${httpPort}/jdk.zip` };
    expect((await ensureTool(tool, options)).installed).toBe(true);
    expect((await ensureTool(tool, options)).installed).toBe(false);
    // Le marker enregistre la version
    const marker = JSON.parse(
      await readFile(join(toolInstallDir(dir, tool), '.mojito-tool.json'), 'utf-8'),
    );
    expect(marker.key).toBe('21');
  });

  it('re-télécharge quand la version déclarée change (JAVA_VERSION 21 → 17)', async () => {
    if (process.platform !== 'win32') return;
    const dir = installDir();
    const options = { installDir: dir, downloadUrl: `http://127.0.0.1:${httpPort}/jdk.zip` };
    await ensureTool({ name: 'java', key: '21', label: 'java 21' }, options);
    const second = await ensureTool({ name: 'java', key: '17', label: 'java 17' }, options);
    expect(second.installed).toBe(true);
    const marker = JSON.parse(
      await readFile(join(dir, '.bin', 'java', '.mojito-tool.json'), 'utf-8'),
    );
    expect(marker.key).toBe('17');
  });

  it('télécharge steamcmd dans <installDir>/.bin/steamcmd (warmup désactivé en test)', async () => {
    if (process.platform !== 'win32') return;
    const dir = installDir();
    const result = await ensureTool(
      { name: 'steamcmd', key: '', label: 'steamcmd' },
      {
        installDir: dir,
        downloadUrl: `http://127.0.0.1:${httpPort}/steamcmd.zip`,
        warmup: false,
      },
    );
    expect(result.installed).toBe(true);
    expect(result.binDir).toBe(join(dir, '.bin', 'steamcmd'));
    await access(join(dir, '.bin', 'steamcmd', 'steamcmd.exe'));
  });
});

// ─── buildToolEnv (PATH + JAVA_HOME) ──────────────────────────────────────────

describe('buildToolEnv', () => {
  it('prépare les bin dirs en tête de PATH et expose JAVA_HOME', () => {
    const env = buildToolEnv([
      { binDir: 'C:\\tools\\java\\bin', env: { JAVA_HOME: 'C:\\tools\\java' } },
      { binDir: 'C:\\tools\\steamcmd', env: {} },
    ]);
    expect(env.PATH.startsWith(`C:\\tools\\java\\bin${delimiter}C:\\tools\\steamcmd${delimiter}`)).toBe(true);
    expect(env.JAVA_HOME).toBe('C:\\tools\\java');
  });

  it('aucun outil → env vide (PATH inchangé)', () => {
    expect(buildToolEnv([])).toEqual({});
  });
});

// ─── runInstall intégration : PATH injecté dans les commandes ────────────────

describe('runInstall avec feature java', () => {
  it('le .bin/java du serveur est utilisé par les commandes (PATH + JAVA_HOME)', async () => {
    if (process.platform !== 'win32') return;

    const installDir = join(tmpRoot, 'srv-path');
    // Outil "pré-installé" : marker + faux java (java.cmd) dans .bin/java/bin
    await mkdir(join(installDir, '.bin', 'java', 'bin'), { recursive: true });
    await writeFile(join(installDir, '.bin', 'java', 'bin', 'java.cmd'), '@echo fake-java\r\n');
    await writeFile(
      join(installDir, '.bin', 'java', '.mojito-tool.json'),
      JSON.stringify({ name: 'java', key: '21', installedAt: new Date().toISOString() }),
      'utf-8',
    );

    const plugin = makePlugin({
      features: ['java'],
      variables: [
        { env: JAVA_VERSION_ENV, name: 'Java', type: 'string', defaultValue: '21' },
      ],
      install: [
        {
          action: 'command',
          // Passe par le PATH : .bin/java/bin précède le PATH de l'hôte —
          // le faux java.cmd doit gagner contre tout java installé sur l'hôte
          command: 'java',
        },
        { action: 'command', command: 'echo %JAVA_HOME%' },
      ],
    });

    const events: InstallEvent[] = [];
    const result = await runInstall({
      plugin,
      variables: {},
      systemVariables: { ...systemVars, SERVER_INSTALL_DIR: installDir },
      installDir,
      onEvent: (event) => events.push(event),
    });

    expect(result.success).toBe(true);
    const outputs = events.flatMap((e) => (e.type === 'step-output' ? [e.text] : []));
    expect(outputs).toContain('fake-java');
    expect(outputs.some((text) => text.includes(join('.bin', 'java')))).toBe(true);

    // Étape 0 = outil java (déjà installé, pas de téléchargement), actions ensuite
    const step0Done = events.find(
      (e): e is Extract<InstallEvent, { type: 'step-done' }> =>
        e.type === 'step-done' && e.step === 0,
    );
    expect(step0Done?.message).toBe('déjà installé');
  });

  it('échoue proprement si la feature java n’a pas de JAVA_VERSION résolue', async () => {
    // Le panel valide en amont (findToolFeatureErrors) — l'agent reste défensif
    const plugin = makePlugin({ features: ['java'] });
    const result = await runInstall({
      plugin,
      variables: {},
      systemVariables: systemVars,
      installDir: join(tmpRoot, 'srv-missing-var'),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain(JAVA_VERSION_ENV);
  });
});

// ─── ensurePluginTools (orchestration) ───────────────────────────────────────

describe('ensurePluginTools', () => {
  it('assure chaque outil dans le .bin du serveur, dans l ordre', async () => {
    if (process.platform !== 'win32') return;
    const dir = newServerDir();
    // Outils déjà provisionnés (markers) — aucun réseau dans ce test
    for (const tool of [
      { name: 'java', key: '21', dir: join(dir, '.bin', 'java') },
      { name: 'steamcmd', key: '', dir: join(dir, '.bin', 'steamcmd') },
    ]) {
      await mkdir(tool.dir, { recursive: true });
      await writeFile(
        join(tool.dir, '.mojito-tool.json'),
        JSON.stringify({ name: tool.name, key: tool.key }),
        'utf-8',
      );
    }

    const runtimes = await ensurePluginTools(
      [
        { name: 'java', key: '21', label: 'java 21' },
        { name: 'steamcmd', key: '', label: 'steamcmd', steamcmd: undefined },
      ],
      dir,
    );
    expect(runtimes.map((r) => r.binDir)).toEqual([
      join(dir, '.bin', 'java', 'bin'),
      join(dir, '.bin', 'steamcmd'),
    ]);
    expect(runtimes.every((r) => !r.installed)).toBe(true);
  });
});
