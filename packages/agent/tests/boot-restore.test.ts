import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServerProcessManager } from '../src/environment/process';
import { isPidAlive } from '../src/environment/pid';
import { ServerManager, PowerActionError } from '../src/server/manager';
import type { ServerAction } from '@mojito/contract';
import { ServerStore } from '../src/internal/server-store';
import { StateStore } from '../src/internal/state-store';
import { restoreServers } from '../src/server/restore';
import { parsePlugin, type Plugin } from '@mojito/contract';

const NODE = process.execPath;

/** Cross-platform spawn command (quoted for shell:true, paths with spaces OK). */
function nodeCommand(code: string): string {
  return `"${NODE}" -e ${JSON.stringify(code)}`;
}

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

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mojito-restore-'));
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

/** Spawns a real orphan process (never through a manager) and returns it. */
function spawnOrphan(): ChildProcess {
  return spawn(NODE, ['-e', 'setInterval(() => {}, 1000);'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

/** Waits until `predicate` returns true, polling every 50 ms. */
async function waitUntil(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('waitUntil timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ─── isPidAlive ──────────────────────────────────────────────────────────────

describe('isPidAlive', () => {
  it('detects a live pid and a dead one', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    // A pid way beyond the pid range — cannot exist
    expect(isPidAlive(999_999_999)).toBe(false);
  });
});

// ─── StateStore ──────────────────────────────────────────────────────────────

describe('StateStore', () => {
  it('write → get roundtrip, survives a new instance, delete', async () => {
    const dir = join(tmpRoot, 'state-a');
    const store = new StateStore(dir);
    await store.write('srv-1', { state: 'running', pid: 1234, adopted: false });

    expect(await store.get('srv-1')).toEqual({ state: 'running', pid: 1234, adopted: false });
    expect(await store.get('srv-unknown')).toBeNull();

    // A new instance re-reads states.json from disk
    const store2 = new StateStore(dir);
    expect(await store2.get('srv-1')).toEqual({ state: 'running', pid: 1234, adopted: false });

    expect(await store.delete('srv-1')).toBe(true);
    expect(await store.delete('srv-1')).toBe(false);
    expect(await store.get('srv-1')).toBeNull();
  });

  it('corrupted file → empty map without crash', async () => {
    const dir = join(tmpRoot, 'state-corrupt');
    await rm(dir, { recursive: true, force: true });
    await writeFile(join(dir, 'states.json'), '{not valid json').catch(() => undefined);
    // WriteFile needs the dir to exist — create it first
    const { mkdir } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'states.json'), '{not valid json');
    const store = new StateStore(dir);
    expect(await store.get('srv-1')).toBeNull();
    expect([...(await store.all()).keys()]).toEqual([]);
  });
});

// ─── ServerProcessManager.adopt ───────────────────────────────────────────────

describe('ServerProcessManager.adopt', () => {
  it('adopts a live orphan: running state, no stdin, stop kills the tree', async () => {
    const orphan = spawnOrphan();
    const events: Array<{ code: number | null; clean: boolean }> = [];
    const states: string[] = [];
    const manager = new ServerProcessManager({
      onExit: (code, clean) => events.push({ code, clean }),
      onStateChange: (s) => states.push(s),
    });

    manager.adopt(orphan.pid!);
    expect(manager.getState()).toBe('running');
    expect(manager.isAdopted()).toBe(true);
    expect(manager.getPid()).toBe(orphan.pid);
    expect(manager.isAlive()).toBe(true);
    // Adopted = no stdin pipe → commands are refused
    expect(manager.sendCommand('list')).toBe(false);

    // Voluntary stop → tree kill → offline (exit is clean, no crash restart)
    await manager.stop();
    await waitUntil(() => manager.getState() === 'offline');
    expect(manager.isAdopted()).toBe(false);
    expect(events[0]).toEqual({ code: null, clean: true });
    expect(states).toContain('stopping');
    expect(states[states.length - 1]).toBe('offline');
    expect(isPidAlive(orphan.pid!)).toBe(false);
  }, 15_000);

  it('adopt of a dead pid is a no-op (stays offline)', () => {
    const manager = new ServerProcessManager();
    manager.adopt(999_999_999);
    expect(manager.getState()).toBe('offline');
    expect(manager.isAdopted()).toBe(false);
  });

  it('adopted death without stop = unclean exit (crash detection path)', async () => {
    const orphan = spawnOrphan();
    const events: Array<{ code: number | null; clean: boolean }> = [];
    const manager = new ServerProcessManager({
      onExit: (code, clean) => events.push({ code, clean }),
    });

    manager.adopt(orphan.pid!);
    // Kill the orphan out-of-band → the adopt poller detects the death
    orphan.kill();
    await waitUntil(() => manager.getState() === 'offline', 5_000);
    expect(events[0]).toEqual({ code: null, clean: false });
  }, 15_000);
});

// ─── ServerManager state persistence ─────────────────────────────────────────

describe('ServerManager state persistence', () => {
  it('start → state written to states.json, offline with no pid after exit', async () => {
    const dir = join(tmpRoot, 'wiring');
    const store = new ServerStore(dir);
    const stateStore = new StateStore(dir);
    const manager = new ServerManager({ store, stateStore });

    const serverId = '11111111-1111-1111-1111-111111111111';
    await store.save({
      serverId,
      name: 'persist-test',
      plugin: makePlugin({
        start: { command: nodeCommand("setTimeout(() => process.exit(0), 300);") },
      }),
      variables: {},
      installDir: dir,
      allocation: { port: 25565, memoryMb: 2048, ip: '0.0.0.0' },
      installedAt: new Date().toISOString(),
    });

    await manager.handlePowerAction(serverId, 'start');

    // While running: state running + the process pid
    await waitUntil(() => stateStore.get(serverId).then((e) => e?.state === 'running'));
    const runningEntry = await stateStore.get(serverId);
    expect(runningEntry).not.toBeNull();
    expect(typeof runningEntry!.pid).toBe('number');

    await waitUntil(() => manager.getState(serverId) === 'offline');

    // The last persisted state is offline with no pid
    const entry = await stateStore.get(serverId);
    expect(entry).toEqual({ state: 'offline', pid: null, adopted: false });
  });
});

// ─── restoreServers (boot restore) ────────────────────────────────────────────

describe('restoreServers', () => {
  async function setup(dataDir: string, serverId: string, startCommand: string) {
    const store = new ServerStore(dataDir);
    const stateStore = new StateStore(dataDir);
    const manager = new ServerManager({ store, stateStore });

    await store.save({
      serverId,
      name: 'restore-test',
      plugin: makePlugin({ start: { command: startCommand } }),
      variables: {},
      installDir: dataDir,
      allocation: { port: 25565, memoryMb: 2048, ip: '0.0.0.0' },
      installedAt: new Date().toISOString(),
    });

    return { store, stateStore, manager };
  }

  it('persisted running + live pid → adopted, no restart', async () => {
    const orphan = spawnOrphan();
    const dataDir = join(tmpRoot, 'restore-adopt');
    const serverId = '22222222-2222-2222-2222-222222222222';
    const markerFile = join(dataDir, 'spawned.txt');
    const { store, stateStore, manager } = await setup(
      dataDir,
      serverId,
      // If the server were (wrongly) restarted, the marker file would appear
      nodeCommand(`require('fs').writeFileSync(${JSON.stringify(markerFile)}, 'x'); setInterval(() => {}, 1000);`),
    );
    await stateStore.write(serverId, { state: 'running', pid: orphan.pid!, adopted: false });

    await restoreServers({ store, stateStore, manager });

    expect(manager.getState(serverId)).toBe('running');
    expect(manager.isRunning(serverId)).toBe(true);

    // Cleanup through the manager itself — killTree on the adopted process
    await manager.handlePowerAction(serverId, 'kill');
    await waitUntil(() => manager.getState(serverId) === 'offline');
    expect(isPidAlive(orphan.pid!)).toBe(false);
  }, 15_000);

  it('persisted running + dead pid → full start', async () => {
    const dataDir = join(tmpRoot, 'restart-dead');
    const serverId = '33333333-3333-3333-3333-333333333333';
    const markerFile = join(dataDir, 'spawned.txt');
    const { store, stateStore, manager } = await setup(
      dataDir,
      serverId,
      nodeCommand(`require('fs').writeFileSync(${JSON.stringify(markerFile)}, 'x'); process.exit(0);`),
    );
    await stateStore.write(serverId, { state: 'running', pid: 999_999_999, adopted: false });

    await restoreServers({ store, stateStore, manager });

    // The start was replayed and the process ran to completion
    await waitUntil(() => manager.getState(serverId) === 'offline');
    const marker = await readFile(markerFile, 'utf-8');
    expect(marker).toBe('x');
  });

  it('persisted offline → no start', async () => {
    const dataDir = join(tmpRoot, 'restore-offline');
    const serverId = '44444444-4444-4444-4444-444444444444';
    const markerFile = join(dataDir, 'spawned.txt');
    const { store, stateStore, manager } = await setup(
      dataDir,
      serverId,
      nodeCommand(`require('fs').writeFileSync(${JSON.stringify(markerFile)}, 'x'); process.exit(0);`),
    );
    await stateStore.write(serverId, { state: 'offline', pid: null, adopted: false });

    await restoreServers({ store, stateStore, manager });

    expect(manager.getState(serverId)).toBe('offline');
    // No start was replayed
    const markerExists = await readFile(markerFile, 'utf-8').then(
      () => true,
      () => false,
    );
    expect(markerExists).toBe(false);
  });

  it('one failing server does not block the others', async () => {
    const dataDir = join(tmpRoot, 'restore-failure');
    const badId = '55555555-5555-5555-5555-555555555555';
    const goodId = '66666666-6666-6666-6666-666666666666';
    const markerFile = join(dataDir, 'good-spawned.txt');
    const { store, stateStore } = await setup(
      dataDir,
      goodId,
      nodeCommand(`require('fs').writeFileSync(${JSON.stringify(markerFile)}, 'x'); process.exit(0);`),
    );
    await store.save({
      serverId: badId,
      name: 'broken',
      plugin: makePlugin({ start: { command: 'echo ok' } }),
      variables: {},
      installDir: dataDir,
      allocation: { port: 25566, memoryMb: 2048, ip: '0.0.0.0' },
      installedAt: new Date().toISOString(),
    });
    await stateStore.write(badId, { state: 'running', pid: 999_999_999, adopted: false });
    await stateStore.write(goodId, { state: 'running', pid: 999_999_999, adopted: false });

    // The bad server's start always fails (e.g. tool preparation error)
    class FailingManager extends ServerManager {
      async handlePowerAction(serverId: string, action: ServerAction): Promise<void> {
        if (serverId === badId) {
          throw new PowerActionError('boom', 'start_failed');
        }
        return super.handlePowerAction(serverId, action);
      }
    }
    const manager = new FailingManager({ store, stateStore });

    const errors: string[] = [];
    await restoreServers({
      store,
      stateStore,
      manager,
      onError: (serverId) => errors.push(serverId),
    });

    // The good server still got started
    await waitUntil(() => manager.getState(goodId) === 'offline');
    const marker = await readFile(markerFile, 'utf-8');
    expect(marker).toBe('x');
    expect(errors).toEqual([badId]);
  });
});
