import type { InstallLogLine } from '@mojito/contract';

/** In-memory install state — the LAST install of each server (debug trail). */
export interface InstallState {
  serverId: string;
  status: 'installing' | 'installed' | 'failed';
  step: number;
  totalSteps: number;
  percent: number;
  message: string;
  error: string | null;
  logs: InstallLogLine[];
  startedAt: string | null;
  finishedAt: string | null;
}

/** Push event for install stream subscribers (console WS). */
export type InstallRegistryEvent =
  /** New install started → replay the trail from scratch (reset). */
  | { kind: 'start' }
  /** Log line appended (replace=false) or progress rewrite (replace=true). */
  | { kind: 'log'; line: InstallLogLine; replace: boolean }
  /** Step/percent/message updated, or the install finished. */
  | { kind: 'update' };

/**
 * Log lines kept per install (debugging aid, not an archive).
 * Generous: steamcmd progress rewrites stream as one line each (\r).
 */
const MAX_LOG_LINES = 2000;

/**
 * Registry of (re)install states (≈ wings install progress, in-memory).
 * The panel polls `GET /servers/:serverId/install` to stream steps, command
 * output and errors — this is what makes installs debuggable.
 */
export class InstallRegistry {
  readonly #states = new Map<string, InstallState>();
  /** Index of the current progress-rewrite line per install (bare \r output). */
  readonly #rewriteIndex = new Map<string, number>();
  /** Push listeners per server (console WS streams installs live). */
  readonly #listeners = new Map<string, Set<(event: InstallRegistryEvent) => void>>();

  /** Subscribes to install events (log lines, step updates, restarts). */
  subscribe(
    serverId: string,
    listener: (event: InstallRegistryEvent) => void,
  ): () => void {
    let listeners = this.#listeners.get(serverId);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(serverId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(serverId);
    };
  }

  #emit(serverId: string, event: InstallRegistryEvent): void {
    for (const listener of this.#listeners.get(serverId) ?? []) listener(event);
  }

  start(serverId: string, message: string): InstallState {
    this.#rewriteIndex.delete(serverId);
    const state: InstallState = {
      serverId,
      status: 'installing',
      step: 0,
      totalSteps: 0,
      percent: 0,
      message,
      error: null,
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message,
        },
      ],
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.#states.set(serverId, state);
    this.#emit(serverId, { kind: 'start' });
    return state;
  }

  get(serverId: string): InstallState | null {
    return this.#states.get(serverId) ?? null;
  }

  isInstalling(serverId: string): boolean {
    return this.#states.get(serverId)?.status === 'installing';
  }

  log(
    serverId: string,
    level: InstallLogLine['level'],
    message: string,
    opts: { rewrite?: boolean } = {},
  ): void {
    const state = this.#states.get(serverId);
    if (!state) return;
    const timestamp = new Date().toISOString();

    // Progress rewrite (bare \r, e.g. steamcmd download %): replace the
    // previous rewrite line instead of accumulating one line per tick.
    const rewriteIdx = this.#rewriteIndex.get(serverId);
    if (opts.rewrite && rewriteIdx !== undefined) {
      const line = { timestamp, level, message };
      state.logs[rewriteIdx] = line;
      this.#emit(serverId, { kind: 'log', line, replace: true });
      return;
    }
    if (!opts.rewrite) this.#rewriteIndex.delete(serverId);

    // Collapse identical consecutive lines (steamcmd: "[----] Installing update...")
    const last = state.logs[state.logs.length - 1];
    if (!opts.rewrite && last && last.message === message) return;

    const line = { timestamp, level, message };
    state.logs.push(line);
    if (opts.rewrite) this.#rewriteIndex.set(serverId, state.logs.length - 1);
    this.#emit(serverId, { kind: 'log', line, replace: opts.rewrite === true });

    if (state.logs.length > MAX_LOG_LINES) {
      const removed = state.logs.length - MAX_LOG_LINES;
      state.logs.splice(0, removed);
      const idx = this.#rewriteIndex.get(serverId);
      if (idx !== undefined) this.#rewriteIndex.set(serverId, Math.max(0, idx - removed));
    }
  }

  update(
    serverId: string,
    patch: Partial<Pick<InstallState, 'step' | 'totalSteps' | 'percent' | 'message'>>,
  ): void {
    const state = this.#states.get(serverId);
    if (!state) return;
    Object.assign(state, patch);
    this.#emit(serverId, { kind: 'update' });
  }

  finish(serverId: string, ok: boolean, error?: string): void {
    const state = this.#states.get(serverId);
    if (!state) return;
    state.status = ok ? 'installed' : 'failed';
    state.error = ok ? null : (error ?? 'Installation échouée');
    state.finishedAt = new Date().toISOString();
    this.log(
      serverId,
      ok ? 'info' : 'error',
      ok ? 'Installation terminée' : (state.error ?? 'Installation échouée'),
    );
    // Terminal status AFTER the final log line → the client banner ends in sync
    this.#emit(serverId, { kind: 'update' });
  }
}
