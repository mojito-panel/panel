import type { ServerProcessManager } from '../environment/process';

/**
 * Live listener on a server's process (console WS streaming).
 * `onLog` receives every log line as it is piped, `onState` every runtime
 * state change. Returned by `ServerInstance.subscribe`.
 */
export interface RegistryListener {
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  onState?: (state: import('../environment/states').ProcessState) => void;
}

/**
 * One server instance (≈ wings server.Server): its process manager, the
 * per-server power lock (sequential actions), the crash-detection timestamp
 * and the live console listeners.
 */
export class ServerInstance {
  readonly manager: ServerProcessManager;
  readonly #listeners = new Set<RegistryListener>();
  /** Promise chain = per-server power lock (sequential actions). */
  #lock: Promise<unknown>;
  #lastCrashAt: number | null;

  constructor(manager: ServerProcessManager) {
    this.manager = manager;
    this.#lock = Promise.resolve();
    this.#lastCrashAt = null;
  }

  /** Timestamp of the last crash (anti-crash-loop). */
  get lastCrashAt(): number | null {
    return this.#lastCrashAt;
  }

  set lastCrashAt(value: number | null) {
    this.#lastCrashAt = value;
  }

  /**
   * Chains `fn` on the per-server power lock — actions run sequentially,
   * a failing action does not break the chain (like wings' locker).
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn);
    this.#lock = run.catch(() => undefined);
    return run;
  }

  /** Lets `kill` run even when the lock is taken (a stuck process stays killable). */
  bypassLock(): void {
    void this.#lock.catch(() => undefined);
  }

  /** Subscribes a live console listener — returns the unsubscribe function. */
  subscribe(listener: RegistryListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Fans a log line out to every live console listener. */
  emitLog(line: string, stream: 'stdout' | 'stderr'): void {
    for (const listener of this.#listeners) {
      listener.onLog?.(line, stream);
    }
  }

  /** Fans a runtime state change out to every live console listener. */
  emitState(state: import('../environment/states').ProcessState): void {
    for (const listener of this.#listeners) {
      listener.onState?.(state);
    }
  }
}
