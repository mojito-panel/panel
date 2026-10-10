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

/** Log lines kept per install (debugging aid, not an archive). */
const MAX_LOG_LINES = 1000;

/**
 * Registry of (re)install states (≈ wings install progress, in-memory).
 * The panel polls `GET /servers/:serverId/install` to stream steps, command
 * output and errors — this is what makes installs debuggable.
 */
export class InstallRegistry {
  readonly #states = new Map<string, InstallState>();

  start(serverId: string, message: string): InstallState {
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
    return state;
  }

  get(serverId: string): InstallState | null {
    return this.#states.get(serverId) ?? null;
  }

  isInstalling(serverId: string): boolean {
    return this.#states.get(serverId)?.status === 'installing';
  }

  log(serverId: string, level: InstallLogLine['level'], message: string): void {
    const state = this.#states.get(serverId);
    if (!state) return;
    state.logs.push({ timestamp: new Date().toISOString(), level, message });
    if (state.logs.length > MAX_LOG_LINES) {
      state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
    }
  }

  update(
    serverId: string,
    patch: Partial<Pick<InstallState, 'step' | 'totalSteps' | 'percent' | 'message'>>,
  ): void {
    const state = this.#states.get(serverId);
    if (!state) return;
    Object.assign(state, patch);
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
  }
}
