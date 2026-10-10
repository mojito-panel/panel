import { spawn, execFile, type ChildProcess } from 'node:child_process';
import type { StopConfig } from '@mojito/contract';
import { toPanelStatus, type ProcessState } from './states';
import { isPidAlive } from './pid';

export interface ProcessSpawnConfig {
  /** Templated start command. */
  command: string;
  /** Working directory (installDir). */
  cwd: string;
  /** Resolved variables, injected into the process environment. */
  env: Record<string, string>;
  /** Plugin ready pattern (optional detection). */
  readyPattern?: string;
  /** Plugin graceful stop config. */
  stop?: StopConfig;
}

export interface ProcessEvents {
  /** Each log line (piped stdout/stderr — no PTY required). */
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  onStateChange?: (state: ProcessState) => void;
  /** Emitted when the readyPattern matches (after entering running). */
  onReady?: () => void;
  /**
   * Emitted on process exit. `clean` = expected exit (requested stop)
   * or exit code 0.
   */
  onExit?: (code: number | null, clean: boolean) => void;
}

const DEFAULT_STOP_TIMEOUT_MS = 30_000;
const KILL_POLL_INTERVAL_MS = 500;
const KILL_POLL_TIMEOUT_MS = 10_000;
/** How often an adopted (re-attached) process is probed for liveness. */
const ADOPT_POLL_INTERVAL_MS = 1_500;

/**
 * Manages a server process: spawn with piped stdin/stdout
 * (equivalent of wings' Docker attach — without native dependency),
 * interactive console, graceful stop with a timeout → poll → kill sequence.
 *
 * One manager = one server. Action locking (power lock) is
 * handled by the ProcessRegistry.
 */
export class ServerProcessManager {
  #child: ChildProcess | null = null;
  /** PID of an adopted process started by a previous agent run (no pipes). */
  #adoptedPid: number | null = null;
  #adoptTimer: ReturnType<typeof setInterval> | null = null;
  #state: ProcessState = 'offline';
  #stoppedVoluntarily = false;
  #logBuffer: string[] = [];
  /** Index of the buffer's first line (shifts when the ring buffer truncates). */
  #logStart = 0;
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

  /**
   * Incremental logs: lines with index > `after`.
   * If the ring buffer truncated requested lines, returns the whole buffer.
   */
  getLogsAfter(after: number): { lines: string[]; next: number } {
    const start = this.#logStart;
    const next = start + this.#logBuffer.length;
    if (after < start) return { lines: [...this.#logBuffer], next };
    if (after >= next) return { lines: [], next };
    return { lines: this.#logBuffer.slice(after - start), next };
  }

  /** PID of the tracked process (spawned child or adopted orphan), else null. */
  getPid(): number | null {
    return this.#child?.pid ?? this.#adoptedPid;
  }

  /** True when the tracked process was adopted from a previous agent run. */
  isAdopted(): boolean {
    return this.#adoptedPid !== null;
  }

  #clearAdoptTimer(): void {
    if (this.#adoptTimer) {
      clearInterval(this.#adoptTimer);
      this.#adoptTimer = null;
    }
  }

  /**
   * Adopts a still-running process started by a previous agent run
   * (≈ wings re-attaching to a running Docker container at boot).
   * Without pipes we cannot stream new output or send commands — the server
   * is marked running and probed for liveness; an unexpected death goes
   * through the normal crash-detection path. No-op if the pid is dead.
   */
  adopt(pid: number): void {
    if (this.#child || this.#adoptedPid) {
      throw new Error('Le process est déjà en cours d’exécution');
    }
    if (!isPidAlive(pid)) return;

    this.#stoppedVoluntarily = false;
    this.#adoptedPid = pid;
    this.#setState('running');

    this.#adoptTimer = setInterval(() => {
      const current = this.#adoptedPid;
      if (current === null) return;
      if (isPidAlive(current)) return;
      this.#adoptedPid = null;
      this.#clearAdoptTimer();
      this.#setState('offline');
      this.#events.onExit?.(null, this.#stoppedVoluntarily);
    }, ADOPT_POLL_INTERVAL_MS);
    this.#adoptTimer.unref?.();
  }

  #setState(next: ProcessState): void {
    if (this.#state === next) return;
    this.#state = next;
    this.#events.onStateChange?.(next);
  }

  #pushLog(line: string, stream: 'stdout' | 'stderr'): void {
    this.#logBuffer.push(line);
    if (this.#logBuffer.length > this.#maxLogLines) {
      const removed = this.#logBuffer.length - this.#maxLogLines;
      this.#logBuffer.splice(0, removed);
      this.#logStart += removed;
    }
    this.#events.onLog?.(line, stream);
  }

  /**
   * Starts the process. Switches to `running` right after spawn
   * (like wings) — the readyPattern emits the `ready` event separately.
   */
  spawn(config: ProcessSpawnConfig): void {
    if (this.#child || this.#adoptedPid) {
      throw new Error('Le process est déjà en cours d’exécution');
    }

    this.#spawnConfig = config;
    this.#stoppedVoluntarily = false;
    this.#logBuffer = [];
    this.#logStart = 0;
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

    // Like wings: running as soon as spawn is effective
    this.#setState('running');

    const pipeStream = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line === '') continue;
        this.#pushLog(line, stream);
        if (stream === 'stdout' && this.#readyRegExp && this.#readyRegExp.test(line)) {
          this.#readyRegExp = null; // ready only once
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
   * Sends a command to the process stdin (interactive console).
   * Returns false if the process is not alive.
   */
  sendCommand(command: string): boolean {
    if (!this.#child?.stdin || !this.isAlive()) {
      return false;
    }
    this.#child.stdin.write(command + '\n');
    return true;
  }

  /**
   * Graceful stop — wings sequence:
   * 1. state → `stopping` (do not trigger crash detection)
   * 2. type `command` → write to stdin; type `signal` → direct kill
   * 3. wait for exit during `timeoutMs` (default 30s)
   * 4. still alive → kill the process tree
   */
  async stop(): Promise<void> {
    if (this.#state === 'offline') return;

    // Adopted process: no stdin pipe → straight to the tree kill. The adopt
    // poller flips the state to offline once the pid is confirmed dead.
    if (this.#adoptedPid) {
      this.#stoppedVoluntarily = true;
      this.#setState('stopping');
      await this.#killPidTree(this.#adoptedPid);
      await this.#waitForExit(DEFAULT_STOP_TIMEOUT_MS, KILL_POLL_INTERVAL_MS);
      return;
    }

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

    // Wait for exit during timeoutMs
    const exited = await this.#waitForExit(timeoutMs);
    if (exited) return;

    // Still alive → kill the tree (last resort)
    await this.killTree();
  }

  /** Immediately kills the process tree (force-passes everything). */
  async killTree(): Promise<void> {
    if (this.#state === 'offline') return;

    if (this.#adoptedPid) {
      this.#stoppedVoluntarily = true;
      this.#setState('stopping');
      await this.#killPidTree(this.#adoptedPid);
      // Confirmation poll (500ms for 10s — like wings)
      await this.#waitForExit(KILL_POLL_TIMEOUT_MS, KILL_POLL_INTERVAL_MS);
      return;
    }

    if (!this.#child || this.#state === 'offline') return;

    this.#stoppedVoluntarily = true;
    this.#setState('stopping');

    const pid = this.#child.pid;
    if (pid === undefined) {
      this.#child.kill('SIGKILL');
      return;
    }

    await this.#killPidTree(pid);

    // Confirmation poll (500ms for 10s — like wings)
    await this.#waitForExit(KILL_POLL_TIMEOUT_MS, KILL_POLL_INTERVAL_MS);
  }

  /** Kills a whole process tree by PID — taskkill /T /F on Windows. */
  #killPidTree(pid: number): Promise<void> {
    if (process.platform === 'win32') {
      return new Promise<void>((resolve) => {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
      });
    }
    return new Promise<void>((resolve) => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already dead */
        }
      }
      resolve();
    });
  }

  #sendSignal(signal: string): void {
    if (!this.#child) return;
    // Windows does not support POSIX signals — kill() terminates anyway
    try {
      this.#child.kill(signal as NodeJS.Signals);
    } catch {
      /* the process may already be dead */
    }
  }

  /** Waits for the process to exit. Polls every `intervalMs`. */
  #waitForExit(timeoutMs: number, intervalMs = 100): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        // Adopted processes have no child handle — the state only flips to
        // offline once the adopt poller confirms the pid is dead.
        if (this.#state === 'offline' || (!this.#child && !this.#adoptedPid)) {
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
