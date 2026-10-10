import type { ServerAction } from '@mojito/contract';
import { ServerProcessManager, type ProcessEvents } from '../environment/process';
import type { ProcessState } from '../environment/states';
import type { ServerStore } from '../internal/server-store';
import type { StateStore } from '../internal/state-store';
import { ServerInstance, type RegistryListener } from './server';
import { PowerActionError } from './errors';
import { handlePowerAction } from './power';
import { handleUncleanExit } from './crash';

export type { RegistryListener };
export { PowerActionError };

export interface ServerManagerOptions {
  store: ServerStore;
  /** Runtime state persistence (states.json) — omitted in unit tests. */
  stateStore?: StateStore;
  /** Anti-crash-loop: no auto restart if the last crash is < N seconds ago. */
  crashLoopSeconds?: number;
  /** Event factory for a server's manager (extra listeners, phase 3). */
  createEvents?: (serverId: string) => ProcessEvents;
}

/**
 * Collection of server instances (≈ wings server.Manager): lazily creates
 * one ServerInstance per serverId, wires its process events (live console
 * fan-out + crash detection) and exposes the facade used by the router.
 */
export class ServerManager {
  readonly #servers = new Map<string, ServerInstance>();
  readonly #store: ServerStore;
  readonly #stateStore: StateStore | undefined;
  readonly #crashLoopMs: number;
  readonly #createEvents: ((serverId: string) => ProcessEvents) | undefined;

  constructor(options: ServerManagerOptions) {
    this.#store = options.store;
    this.#stateStore = options.stateStore;
    this.#crashLoopMs = (options.crashLoopSeconds ?? 60) * 1000;
    this.#createEvents = options.createEvents;
  }

  #getOrCreate(serverId: string): ServerInstance {
    let instance = this.#servers.get(serverId);
    if (!instance) {
      instance = new ServerInstance(new ServerProcessManager(this.#buildEvents(serverId)));
      this.#servers.set(serverId, instance);
    }
    return instance;
  }

  /** Persists the current runtime state + pid of a server (states.json). */
  #persistState(serverId: string): void {
    if (!this.#stateStore) return;
    const instance = this.#servers.get(serverId);
    if (!instance) return;
    void this.#stateStore.write(serverId, {
      state: instance.manager.getState(),
      pid: instance.manager.getPid(),
      adopted: instance.manager.isAdopted(),
    });
  }

  #buildEvents(serverId: string): ProcessEvents {
    const custom = this.#createEvents?.(serverId);
    return {
      ...custom,
      onLog: (line, stream) => {
        custom?.onLog?.(line, stream);
        this.#servers.get(serverId)?.emitLog(line, stream);
      },
      onStateChange: (state) => {
        custom?.onStateChange?.(state);
        this.#servers.get(serverId)?.emitState(state);
        this.#persistState(serverId);
      },
      onExit: (code, clean) => {
        custom?.onExit?.(code, clean);
        if (!clean) {
          const instance = this.#servers.get(serverId);
          if (instance) {
            void handleUncleanExit(instance, serverId, this.#store, this.#crashLoopMs);
          }
        }
      },
    };
  }

  getState(serverId: string): ProcessState {
    return this.#getOrCreate(serverId).manager.getState();
  }

  getLogs(serverId: string): string[] {
    return this.#getOrCreate(serverId).manager.getLogs();
  }

  /** Incremental logs (panel live console fallback). */
  getLogsAfter(serverId: string, after: number): { lines: string[]; next: number } {
    return this.#getOrCreate(serverId).manager.getLogsAfter(after);
  }

  isRunning(serverId: string): boolean {
    return this.#getOrCreate(serverId).manager.isAlive();
  }

  /**
   * Removes a server from the collection (after store deletion).
   * The caller must check that the process is stopped first.
   */
  forget(serverId: string): boolean {
    return this.#servers.delete(serverId);
  }

  /** Subscribes to a server's live logs/state (console WS) — returns the unsubscribe function. */
  subscribe(serverId: string, listener: RegistryListener): () => void {
    return this.#getOrCreate(serverId).subscribe(listener);
  }

  /** Adopts a still-running process from a previous agent run (boot restore). */
  adopt(serverId: string, pid: number): void {
    this.#getOrCreate(serverId).manager.adopt(pid);
  }

  async sendCommand(serverId: string, command: string): Promise<boolean> {
    const stored = await this.#store.get(serverId);
    if (!stored) {
      throw new PowerActionError('Serveur inconnu', 'not_found');
    }
    return this.#getOrCreate(serverId).manager.sendCommand(command);
  }

  /** Runs a power action — serialized by the server's lock. */
  async handlePowerAction(serverId: string, action: ServerAction): Promise<void> {
    const stored = await this.#store.get(serverId);
    if (!stored) {
      throw new PowerActionError('Serveur inconnu', 'not_found');
    }
    await handlePowerAction(this.#getOrCreate(serverId), stored, action);
  }
}
