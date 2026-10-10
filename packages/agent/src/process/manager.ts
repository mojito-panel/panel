import { spawn, execFile, type ChildProcess } from 'node:child_process';
import type { StopConfig } from '@mojito/contract';
import { toPanelStatus, type ProcessState } from './states';

export interface ProcessSpawnConfig {
  /** Commande start templatisée. */
  command: string;
  /** Dossier de travail (installDir). */
  cwd: string;
  /** Variables résolues, injectées dans l'environnement du process. */
  env: Record<string, string>;
  /** Pattern ready du plugin (détection optionnelle). */
  readyPattern?: string;
  /** Config de stop gracieux du plugin. */
  stop?: StopConfig;
}

export interface ProcessEvents {
  /** Chaque ligne de log (stdout/stderr pipés — pas de PTY requis). */
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  onStateChange?: (state: ProcessState) => void;
  /** Émis quand le readyPattern matche (après le passage en running). */
  onReady?: () => void;
  /**
   * Émis à la sortie du process. `clean` = sortie attendue (stop demandé)
   * ou exit code 0.
   */
  onExit?: (code: number | null, clean: boolean) => void;
}

const DEFAULT_STOP_TIMEOUT_MS = 30_000;
const KILL_POLL_INTERVAL_MS = 500;
const KILL_POLL_TIMEOUT_MS = 10_000;

/**
 * Manager d'un process serveur : spawn avec stdin/stdout pipés
 * (équivalent de l'attach Docker de wings — sans dépendance native),
 * console interactive, stop gracieux avec séquence timeout → poll → kill.
 *
 * Un manager = un serveur. Le verrouillage des actions (power lock) est
 * géré par le ProcessRegistry.
 */
export class ServerProcessManager {
  #child: ChildProcess | null = null;
  #state: ProcessState = 'offline';
  #stoppedVoluntarily = false;
  #logBuffer: string[] = [];
  #readyRegExp: RegExp | null = null;
  readonly #maxLogLines = 1000;
  readonly #events: ProcessEvents;
  #spawnConfig: ProcessSpawnConfig | null = null;

  constructor(events: ProcessEvents = {}) {
    this.#events = events;
  }

  getState(): ProcessState {
    return this.#state;
  }

  getPanelStatus(): ReturnType<typeof toPanelStatus> {
    return toPanelStatus(this.#state, false);
  }

  isAlive(): boolean {
    return this.#state === 'starting' || this.#state === 'running' || this.#state === 'stopping';
  }

  getLogs(): string[] {
    return [...this.#logBuffer];
  }

  #setState(next: ProcessState): void {
    if (this.#state === next) return;
    this.#state = next;
    this.#events.onStateChange?.(next);
  }

  #pushLog(line: string, stream: 'stdout' | 'stderr'): void {
    this.#logBuffer.push(line);
    if (this.#logBuffer.length > this.#maxLogLines) {
      this.#logBuffer.splice(0, this.#logBuffer.length - this.#maxLogLines);
    }
    this.#events.onLog?.(line, stream);
  }

  /**
   * Démarre le process. Passage immédiat en `running` après le spawn
   * (comme wings) — le readyPattern émet l'event `ready` séparément.
   */
  spawn(config: ProcessSpawnConfig): void {
    if (this.#child) {
      throw new Error('Le process est déjà en cours d’exécution');
    }

    this.#spawnConfig = config;
    this.#stoppedVoluntarily = false;
    this.#logBuffer = [];
    this.#readyRegExp = config.readyPattern ? new RegExp(config.readyPattern) : null;
    this.#setState('starting');

    const child = spawn(config.command, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#child = child;

    // Comme wings : running dès le spawn effectif
    this.#setState('running');

    const pipeStream = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line === '') continue;
        this.#pushLog(line, stream);
        if (stream === 'stdout' && this.#readyRegExp && this.#readyRegExp.test(line)) {
          this.#readyRegExp = null; // ready une seule fois
          this.#events.onReady?.();
        }
      }
    };
    child.stdout?.on('data', pipeStream('stdout'));
    child.stderr?.on('data', pipeStream('stderr'));

    child.on('error', (err) => {
      this.#pushLog(`Erreur du process : ${err.message}`, 'stderr');
    });

    child.on('exit', (code) => {
      const clean = this.#stoppedVoluntarily || code === 0;
      this.#child = null;
      this.#setState('offline');
      this.#events.onExit?.(code, clean);
    });
  }

  /**
   * Envoie une commande sur le stdin du process (console interactive).
   * Retourne false si le process n'est pas vivant.
   */
  sendCommand(command: string): boolean {
    if (!this.#child?.stdin || !this.isAlive()) {
      return false;
    }
    this.#child.stdin.write(command + '\n');
    return true;
  }

  /**
   * Stop gracieux — séquence wings :
   * 1. état → `stopping` (ne pas déclencher la crash detection)
   * 2. type `command` → écrit sur stdin ; type `signal` → kill direct
   * 3. attente de sortie pendant `timeoutMs` (défaut 30s)
   * 4. toujours vivant → kill de l'arbre de process
   */
  async stop(): Promise<void> {
    if (!this.#child || this.#state === 'offline') return;

    this.#stoppedVoluntarily = true;
    this.#setState('stopping');

    const stop = this.#spawnConfig?.stop;
    const type = stop?.type ?? 'signal';
    const value = stop?.value ?? 'SIGKILL';
    const timeoutMs = stop?.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

    if (type === 'command') {
      this.sendCommand(value);
    } else {
      this.#sendSignal(value);
    }

    // Attendre la sortie pendant timeoutMs
    const exited = await this.#waitForExit(timeoutMs);
    if (exited) return;

    // Toujours vivant → kill de l'arbre (dernier recours)
    await this.killTree();
  }

  /** Kill immédiat de l'arbre de process (force-passe tout). */
  async killTree(): Promise<void> {
    if (!this.#child || this.#state === 'offline') return;

    this.#stoppedVoluntarily = true;
    this.#setState('stopping');

    const pid = this.#child.pid;
    if (pid === undefined) {
      this.#child.kill('SIGKILL');
      return;
    }

    if (process.platform === 'win32') {
      // taskkill /T tue l'arbre complet, /F force
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          this.#child.kill('SIGKILL');
        } catch {
          /* déjà mort */
        }
      }
    }

    // Poll de confirmation (500ms pendant 10s — comme wings)
    await this.#waitForExit(KILL_POLL_TIMEOUT_MS, KILL_POLL_INTERVAL_MS);
  }

  #sendSignal(signal: string): void {
    if (!this.#child) return;
    // Windows ne supporte pas les signaux POSIX — kill() termine de toute façon
    try {
      this.#child.kill(signal as NodeJS.Signals);
    } catch {
      /* le process est peut-être déjà mort */
    }
  }

  /** Attend la sortie du process. Poll toutes les `intervalMs`. */
  #waitForExit(timeoutMs: number, intervalMs = 100): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (this.#state === 'offline' || !this.#child) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(check, intervalMs);
      };
      check();
    });
  }
}
