import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerProcessManager } from '../src/process/manager';
import { ProcessRegistry, PowerActionError } from '../src/process/registry';
import { ServerStore } from '../src/process/store';
import { toPanelStatus } from '../src/process/states';
import { parsePlugin, type Plugin } from '@mojito/contract';

const NODE = process.execPath;

/** Commande spawn cross-platform (quotée pour shell:true, chemins avec espaces OK). */
function nodeCommand(code: string): string {
  return `"${NODE}" -e ${JSON.stringify(code)}`;
}

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mojito-process-'));
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ─── ServerProcessManager ─────────────────────────────────────────────────────

describe('ServerProcessManager', () => {
  it('spawn → running, logs capturés, exit propre → offline', async () => {
    const logs: string[] = [];
    const exitCalls: Array<{ code: number | null; clean: boolean }> = [];
    const manager = new ServerProcessManager({
      onLog: (line) => logs.push(line),
      onExit: (code, clean) => exitCalls.push({ code, clean }),
    });

    manager.spawn({
      command: nodeCommand("console.log('hello from process'); process.exit(0);"),
      cwd: tmpRoot,
      env: {},
    });

    expect(manager.getState()).toBe('running');

    // Attendre la sortie
    await new Promise<void>((resolve) => {
      const check = () => (manager.getState() === 'offline' ? resolve() : setTimeout(check, 50));
      check();
    });

    expect(manager.getState()).toBe('offline');
    expect(logs).toContain('hello from process');
    expect(exitCalls.length).toBe(1);
    expect(exitCalls[0]).toEqual({ code: 0, clean: true });
  });

  it('injecte les variables d environnement dans le process', async () => {
    const logs: string[] = [];
    const manager = new ServerProcessManager({ onLog: (l) => logs.push(l) });

    manager.spawn({
      command: nodeCommand("console.log('PORT=' + process.env.MOJITO_TEST_PORT); process.exit(0);"),
      cwd: tmpRoot,
      env: { MOJITO_TEST_PORT: '25565' },
    });

    await new Promise<void>((resolve) => {
      const check = () => (manager.getState() === 'offline' ? resolve() : setTimeout(check, 50));
      check();
    });

    expect(logs).toContain('PORT=25565');
  });

  it('readyPattern émet onReady une seule fois', async () => {
    let readyCount = 0;
    const manager = new ServerProcessManager({
      onReady: () => readyCount++,
    });

    manager.spawn({
      command: nodeCommand("console.log('[Server] DONE loading'); console.log('[Server] DONE again'); setTimeout(() => process.exit(0), 300);"),
      cwd: tmpRoot,
      env: {},
      readyPattern: 'DONE loading',
    });

    await new Promise<void>((resolve) => {
      const check = () => (manager.getState() === 'offline' ? resolve() : setTimeout(check, 50));
      check();
    });

    expect(readyCount).toBe(1);
  });

  it('sendCommand écrit sur le stdin du process (console interactive)', async () => {
    const logs: string[] = [];
    const manager = new ServerProcessManager({ onLog: (l) => logs.push(l) });

    manager.spawn({
      command: nodeCommand(
        "process.stdin.on('data', (d) => { console.log('echo:' + d.toString().trim()); process.exit(0); });",
      ),
      cwd: tmpRoot,
      env: {},
    });

    expect(manager.sendCommand('hello console')).toBe(true);

    await new Promise<void>((resolve) => {
      const check = () => (manager.getState() === 'offline' ? resolve() : setTimeout(check, 50));
      check();
    });

    expect(logs).toContain('echo:hello console');
  });

  it('sendCommand retourne false si le process est offline', () => {
    const manager = new ServerProcessManager();
    expect(manager.sendCommand('x')).toBe(false);
  });

  it('stop gracieux par commande : stopping → sortie avant timeout → offline', async () => {
    const states: string[] = [];
    const manager = new ServerProcessManager({ onStateChange: (s) => states.push(s) });

    manager.spawn({
      command: nodeCommand(
        "process.stdin.on('data', (d) => { if (d.toString().trim() === 'stop-now') process.exit(0); }); setInterval(() => {}, 1000);",
      ),
      cwd: tmpRoot,
      env: {},
      stop: { type: 'command', value: 'stop-now', timeoutMs: 5000 },
    });

    expect(manager.getState()).toBe('running');

    const start = Date.now();
    await manager.stop();
    const duration = Date.now() - start;

    expect(manager.getState()).toBe('offline');
    expect(duration).toBeLessThan(5000);
    // Passé par stopping avant offline (pas de crash detection déclenchée)
    expect(states).toContain('stopping');
    expect(states[states.length - 1]).toBe('offline');
  });

  it('killTree force la sortie d un process qui ignore le stop', async () => {
    const manager = new ServerProcessManager();

    manager.spawn({
      command: nodeCommand("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"),
      cwd: tmpRoot,
      env: {},
      stop: { type: 'signal', value: 'SIGTERM', timeoutMs: 300 },
    });

    expect(manager.getState()).toBe('running');

    // stop : le process ignore le signal → killTree en dernier recours
    await manager.stop();

    expect(manager.getState()).toBe('offline');
  });

  it('exit code non nul sans stop demandé = crash (non clean)', async () => {
    const exitCalls: Array<{ code: number | null; clean: boolean }> = [];
    const manager = new ServerProcessManager({
      onExit: (code, clean) => exitCalls.push({ code, clean }),
    });

    manager.spawn({
      command: nodeCommand('process.exit(3);'),
      cwd: tmpRoot,
      env: {},
    });

    await new Promise<void>((resolve) => {
      const check = () => (manager.getState() === 'offline' ? resolve() : setTimeout(check, 50));
      check();
    });

    expect(exitCalls[0]).toEqual({ code: 3, clean: false });
  });

  it('ring buffer : le buffer de logs est limité', async () => {
    const manager = new ServerProcessManager();
    // Max 1000 lignes — on en génère 1500 en spammant stdout
    manager.spawn({
      command: nodeCommand(
        "for (let i = 0; i < 1500; i++) console.log('line-' + i); process.exit(0);",
      ),
      cwd: tmpRoot,
      env: {},
    });

    await new Promise<void>((resolve) => {
      const check = () => (manager.getState() === 'offline' ? resolve() : setTimeout(check, 50));
      check();
    });

    expect(manager.getLogs().length).toBeLessThanOrEqual(1000);
    expect(manager.getLogs()[manager.getLogs().length - 1]).toBe('line-1499');
  });
});

// ─── ServerStore ─────────────────────────────────────────────────────────────

describe('ServerStore', () => {
  it('save, get, list, delete avec écriture sur disque', async () => {
    const store = new ServerStore(tmpRoot);
    const plugin = makePlugin();
    const entry = {
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'test',
      plugin,
      variables: {},
      installDir: join(tmpRoot, 'srv-store'),
      allocation: { port: 25565, memoryMb: 2048, ip: '0.0.0.0' },
      installedAt: new Date().toISOString(),
    };

    await store.save(entry);
    expect(await store.get(entry.serverId)).not.toBeNull();
    expect((await store.list()).length).toBe(1);

    // Nouvelle instance relit le fichier
    const store2 = new ServerStore(tmpRoot);
    expect(await store2.get(entry.serverId)).not.toBeNull();

    expect(await store.delete(entry.serverId)).toBe(true);
    expect(await store.delete(entry.serverId)).toBe(false);
    expect(await store.get(entry.serverId)).toBeNull();
  });

  it('fichier corrompu → repart vide sans crash', async () => {
    const corruptDir = join(tmpRoot, 'corrupt');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(corruptDir, { recursive: true });
    await writeFile(join(corruptDir, 'servers.json'), '{not valid json');
    const store = new ServerStore(corruptDir);
    expect(await store.list()).toEqual([]);
  });
});

// ─── ProcessRegistry (power lock + crash detection) ───────────────────────────

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return parsePlugin({
    schemaVersion: 2,
    id: 'test-plugin',
    name: 'Test',
    author: 'moi',
    install: [],
    start: { command: 'echo ok' },
    ...overrides,
  });
}

describe('ProcessRegistry', () => {
  async function setupRegistry(opts: { crashLoopSeconds?: number } = {}) {
    const store = new ServerStore(tmpRoot);
    const registry = new ProcessRegistry({ store, crashLoopSeconds: opts.crashLoopSeconds });
    const markerFile = join(tmpRoot, 'spawn-count.txt');

    // Plugin dont le process de démarrage append une ligne dans un fichier
    // (permet de compter les spawns réels, y compris les restarts auto)
    const plugin = makePlugin({
      start: {
        command: nodeCommand(
          `require('fs').appendFileSync(${JSON.stringify(markerFile)}, 'x'); process.exit(0);`,
        ),
      },
    });

    const serverId = '550e8400-e29b-41d4-a716-446655440000';
    await store.save({
      serverId,
      name: 'test',
      plugin,
      variables: {},
      installDir: tmpRoot,
      allocation: { port: 25565, memoryMb: 2048, ip: '0.0.0.0' },
      installedAt: new Date().toISOString(),
    });

    return { registry, store, serverId, markerFile };
  }

  it('start unknown → not_found', async () => {
    const { registry } = await setupRegistry();
    await expect(
      registry.handlePowerAction('660e8400-e29b-41d4-a716-446655440000', 'start'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('start → spawn du process (exit 0 = clean, pas de restart)', async () => {
    const { registry, serverId, markerFile } = await setupRegistry();
    await registry.handlePowerAction(serverId, 'start');

    // Le process a tourné et est sorti proprement
    await new Promise((r) => setTimeout(r, 400));
    expect((await readFile(markerFile, 'utf-8')).trim()).toBe('x');
    expect(registry.getState(serverId)).toBe('offline');
  });

  it('double start concurrent → la 2e action est rejetée (power lock)', async () => {
    const { registry, serverId, markerFile } = await setupRegistry();
    // Process long pour que le 1er start soit encore "running"
    const store = new ServerStore(tmpRoot);
    await store.save({
      serverId,
      name: 'test',
      plugin: makePlugin({
        start: { command: nodeCommand('setInterval(() => {}, 1000);') },
      }),
      variables: {},
      installDir: tmpRoot,
      allocation: { port: 25565, memoryMb: 2048, ip: '0.0.0.0' },
      installedAt: new Date().toISOString(),
    });

    await registry.handlePowerAction(serverId, 'start');
    expect(registry.getState(serverId)).toBe('running');

    await expect(registry.handlePowerAction(serverId, 'start')).rejects.toMatchObject({
      code: 'already_running',
    });

    // kill force-passe le verrou → offline
    await registry.handlePowerAction(serverId, 'kill');
    expect(registry.getState(serverId)).toBe('offline');
  });

  it('crash detection : restart auto puis anti-crash-loop', async () => {
    // Process qui crash immédiatement (exit 1) → restart auto → re-crash trop
    // récent → pas de 3e spawn (anti-loop, comme wings crashTooFrequent)
    const markerFile = join(tmpRoot, 'crash-count.txt');
    const store = new ServerStore(tmpRoot);
    const registry = new ProcessRegistry({ store, crashLoopSeconds: 60 });
    const serverId = '770e8400-e29b-41d4-a716-446655440000';

    let spawnCount = 0;

    await store.save({
      serverId,
      name: 'test-crash',
      plugin: makePlugin({
        start: {
          command: nodeCommand(
            `require('fs').appendFileSync(${JSON.stringify(markerFile)}, 'x'); process.exit(1);`,
          ),
        },
      }),
      variables: {},
      installDir: tmpRoot,
      allocation: { port: 25565, memoryMb: 2048, ip: '0.0.0.0' },
      installedAt: new Date().toISOString(),
    });

    // 1er start manuel → crash → restart auto → crash → anti-loop stop
    await registry.handlePowerAction(serverId, 'start');

    // Attendre les 2 spawns (initial + restart auto) + marge anti-loop
    await new Promise((r) => setTimeout(r, 1500));

    spawnCount = (await readFile(markerFile, 'utf-8')).split('x').length - 1;
    expect(spawnCount).toBe(2); // initial + 1 restart auto, pas plus (anti-loop)
    expect(registry.getState(serverId)).toBe('offline');
  }, 15000);

  it('toPanelStatus : mapping états runtime → panel', () => {
    expect(toPanelStatus('offline', false)).toBe('stopped');
    expect(toPanelStatus('offline', true)).toBe('crashed');
    expect(toPanelStatus('running', false)).toBe('running');
    expect(toPanelStatus('starting', false)).toBe('running');
    expect(toPanelStatus('stopping', false)).toBe('running');
  });

  it('PowerActionError expose son code', () => {
    const err = new PowerActionError('test', 'not_running');
    expect(err.code).toBe('not_running');
  });
});
