import type { Plugin, ServerAction } from '@mojito/contract';
import { resolveVariables, render } from '../runner/templating';
import { ServerProcessManager, type ProcessEvents } from './manager';
import { buildSystemVariables } from './system-vars';
import type { ServerStore, StoredServer } from './store';
import type { ProcessState } from './states';

export interface RegistryOptions {
  store: ServerStore;
  /** Anti-crash-loop: no auto restart if the last crash is < N seconds ago. */
  crashLoopSeconds?: number;
  /** Event factory for a server's manager (WS logs, phase 3). */
  createEvents?: (serverId: string) => ProcessEvents;
}

interface ServerEntry {
  manager: ServerProcessManager;
  /** Promise chain = per-server power lock (sequential actions). */
  lock: Promise<unknown>;
  lastCrashAt: number | null;
}

/** Registry business errors (mapped to HTTP codes by the API). */
export class PowerActionError extends Error {
  readonly code: 'not_found' | 'already_running' | 'not_running' | 'crash_loop';

  constructor(message: string, code: PowerActionError['code']) {
    super(message);
    this.code = code;
  }
}

/**
 * Registry of server processes — per-server power lock (like wings:
 * 1-worker workerpool), crash detection with anti-loop, kill that
 * force-passes the lock.
 */
export class ProcessRegistry {
  readonly #servers = new Map<string, ServerEntry>();
  readonly #store: ServerStore;
  readonly #crashLoopMs: number;
  readonly #createEvents: ((serverId: string) => ProcessEvents) | undefined;

  constructor(options: RegistryOptions) {
    this.#store = options.store;
    this.#crashLoopMs = (options.crashLoopSeconds ?? 60) * 1000;
    this.#createEvents = options.createEvents;
  }

  #getEntry(serverId: string): ServerEntry {
    let entry = this.#servers.get(serverId);
    if (!entry) {
      const manager = new ServerProcessManager(this.#buildEvents(serverId));
      entry = { manager, lock: Promise.resolve(), lastCrashAt: null };
      this.#servers.set(serverId, entry);
    }
    return entry;
  }

  #buildEvents(serverId: string): ProcessEvents {
    const custom = this.#createEvents?.(serverId);
    return {
      ...custom,
      onExit: (code, clean) => {
        custom?.onExit?.(code, clean);
        void this.#handleExit(serverId, code, clean);
      },
    };
  }

  /**
   * Minimal crash detection (wings crash.go):
   * unclean exit (non-zero code, not a voluntary stop) → crashed +
   * auto restart if the last crash is old enough (anti-crash-loop).
   */
  async #handleExit(serverId: string, code: number | null, clean: boolean): Promise<void> {
    if (clean) return;

    const entry = this.#servers.get(serverId);
    if (!entry) return;

    const now = Date.now();
    const previousCrash = entry.lastCrashAt;
    entry.lastCrashAt = now;

    const stored = await this.#store.get(serverId);
    if (!stored) return;

    // Anti-crash-loop (wings crash.go): the previous crash is too recent
    // → no auto restart, the server stays crashed.
    if (
      this.#crashLoopMs > 0 &&
      previousCrash !== null &&
      now - previousCrash < this.#crashLoopMs
    ) {
      return;
    }

    // Auto restart: goes through the power lock again
    try {
      await this.handlePowerAction(serverId, 'start');
    } catch {
      // Auto restart failed — the server stays crashed
    }
  }

  getState(serverId: string): ProcessState {
    return this.#getEntry(serverId).manager.getState();
  }

  getLogs(serverId: string): string[] {
    return this.#getEntry(serverId).manager.getLogs();
  }

  /** Incremental logs (panel live console). */
  getLogsAfter(serverId: string, after: number): { lines: string[]; next: number } {
    return this.#getEntry(serverId).manager.getLogsAfter(after);
  }

  isRunning(serverId: string): boolean {
    return this.#getEntry(serverId).manager.isAlive();
  }

  /**
   * Removes a server from the registry (after store deletion).
   * The caller must check that the process is stopped first.
   */
  forget(serverId: string): boolean {
    return this.#servers.delete(serverId);
  }

  async sendCommand(serverId: string, command: string): Promise<boolean> {
    const stored = await this.#store.get(serverId);
    if (!stored) {
      throw new PowerActionError('Serveur inconnu', 'not_found');
    }
    return this.#getEntry(serverId).manager.sendCommand(command);
  }

  /**
   * Runs a power action — serialized by the server's lock.
   * `kill` force-passes the lock (a stuck process stays killable, like wings).
   */
  async handlePowerAction(serverId: string, action: ServerAction): Promise<void> {
    const stored = await this.#store.get(serverId);
    if (!stored) {
      throw new PowerActionError('Serveur inconnu', 'not_found');
    }

    if (action === 'kill') {
      // Kill: tries the lock, but passes even if it is taken
      const entry = this.#getEntry(serverId);
      void entry.lock.catch(() => undefined);
      await entry.manager.killTree();
      return;
    }

    const entry = this.#getEntry(serverId);
    // Chain the promise: actions run sequentially per server
    const run = entry.lock.then(() => this.#executePowerAction(entry, stored, action));
    entry.lock = run.catch(() => undefined); // the chain does not break on an error
    await run;
  }

  async #executePowerAction(
    entry: ServerEntry,
    stored: StoredServer,
    action: ServerAction,
  ): Promise<void> {
    switch (action) {
      case 'start':
        if (entry.manager.isAlive()) {
          throw new PowerActionError('Le serveur est déjà en cours d’exécution', 'already_running');
        }
        this.#spawnServer(entry, stored);
        return;

      case 'stop':
        await entry.manager.stop();
        return;

      case 'restart':
        await entry.manager.stop();
        this.#spawnServer(entry, stored);
        return;

      case 'kill':
        await entry.manager.killTree();
        return;
    }
  }

  #spawnServer(entry: ServerEntry, stored: StoredServer): void {
    const plugin = stored.plugin as Plugin;
    const systemVars = buildSystemVariables(
      stored.serverId,
      stored.name,
      stored.installDir,
      stored.allocation,
    );
    const resolved = resolveVariables(plugin, stored.variables, systemVars);
    const env: Record<string, string> = {};
    for (const [key, value] of resolved) {
      env[key] = value;
    }

    entry.manager.spawn({
      command: render(plugin.start.command, resolved),
      cwd: stored.installDir,
      env,
      readyPattern: plugin.start.ready?.pattern,
      stop: plugin.start.stop,
    });
  }
}
