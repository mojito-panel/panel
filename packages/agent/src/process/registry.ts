import type { Plugin, ServerAction } from '@mojito/contract';
import { resolveVariables, render } from '../runner/templating';
import { ServerProcessManager, type ProcessEvents } from './manager';
import { buildSystemVariables } from './system-vars';
import type { ServerStore, StoredServer } from './store';
import type { ProcessState } from './states';

export interface RegistryOptions {
  store: ServerStore;
  /** Anti-crash-loop : pas de restart auto si dernier crash < N secondes. */
  crashLoopSeconds?: number;
  /** Factory d'events pour le manager d'un serveur (logs WS phase 3). */
  createEvents?: (serverId: string) => ProcessEvents;
}

interface ServerEntry {
  manager: ServerProcessManager;
  /** Chaîne de promesses = power lock par serveur (actions séquentielles). */
  lock: Promise<unknown>;
  lastCrashAt: number | null;
}

/** Erreurs métier du registry (mappées en codes HTTP par l'API). */
export class PowerActionError extends Error {
  readonly code: 'not_found' | 'already_running' | 'not_running' | 'crash_loop';

  constructor(message: string, code: PowerActionError['code']) {
    super(message);
    this.code = code;
  }
}

/**
 * Registry des process serveurs — power lock par serveur (comme wings :
 * workerpool d'1 worker), crash detection avec anti-loop, kill qui
 * force-passe le verrou.
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
   * Crash detection minimale (wings crash.go) :
   * exit non-propre (code non-nul, pas un stop volontaire) → crashed +
   * restart auto si le dernier crash est assez ancien (anti-crash-loop).
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

    // Anti-crash-loop (wings crash.go) : le précédent crash est trop récent
    // → pas de restart auto, le serveur reste crashed.
    if (
      this.#crashLoopMs > 0 &&
      previousCrash !== null &&
      now - previousCrash < this.#crashLoopMs
    ) {
      return;
    }

    // Restart auto : repasse par le power lock
    try {
      await this.handlePowerAction(serverId, 'start');
    } catch {
      // Le restart auto a échoué — le serveur reste crashed
    }
  }

  getState(serverId: string): ProcessState {
    return this.#getEntry(serverId).manager.getState();
  }

  getLogs(serverId: string): string[] {
    return this.#getEntry(serverId).manager.getLogs();
  }

  /** Logs incrémentaux (console live du panel). */
  getLogsAfter(serverId: string, after: number): { lines: string[]; next: number } {
    return this.#getEntry(serverId).manager.getLogsAfter(after);
  }

  isRunning(serverId: string): boolean {
    return this.#getEntry(serverId).manager.isAlive();
  }

  /**
   * Retire un serveur du registry (après suppression du store).
   * L'appelant doit vérifier que le process est arrêté avant.
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
   * Exécute une action power — sérialisée par le verrou du serveur.
   * `kill` force-passe le verrou (un process coincé reste tuable, comme wings).
   */
  async handlePowerAction(serverId: string, action: ServerAction): Promise<void> {
    const stored = await this.#store.get(serverId);
    if (!stored) {
      throw new PowerActionError('Serveur inconnu', 'not_found');
    }

    if (action === 'kill') {
      // Kill : essaie le verrou, mais passe même s'il est pris
      const entry = this.#getEntry(serverId);
      void entry.lock.catch(() => undefined);
      await entry.manager.killTree();
      return;
    }

    const entry = this.#getEntry(serverId);
    // Chaîne la promesse : les actions s'exécutent séquentiellement par serveur
    const run = entry.lock.then(() => this.#executePowerAction(entry, stored, action));
    entry.lock = run.catch(() => undefined); // la chaîne ne casse pas sur une erreur
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
