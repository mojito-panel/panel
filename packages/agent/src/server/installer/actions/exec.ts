import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { open, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../../templating';
import { resolvePath, type ActionContext } from '../context';

type CommandAction = RunnerActionInput & { action: 'command' };
type ScriptAction = RunnerActionInput & { action: 'script' };

/** Result of a command/script execution. */
export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawns a process, captures stdout/stderr, kills on timeout.
 * Shared base of exec() (via shell) and execProcess() (direct spawn).
 */
export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Live output callback — called as each line completes (\r\n, \r or \n all
   * terminate a line). Empty lines are skipped. Called during the run, before
   * the promise settles.
   * `rewrite` is true for a bare `\r` termination: a progress-bar style
   * rewrite of the current console line (e.g. steamcmd download percentage) —
   * the consumer should replace the previous rewrite line, not accumulate.
   */
  onLine?: (stream: 'stdout' | 'stderr', text: string, rewrite: boolean) => void;
}

function spawnChild(file: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const { onLine } = options;
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    windowsHide: true,
  });

  // Line-oriented streaming state (per stream)
  const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
  const emitLines = (stream: 'stdout' | 'stderr', chunk: string) => {
    if (!onLine) return;
    buffers[stream] += chunk;
    let i = buffers[stream].search(/\r|\n/);
    while (i >= 0) {
      const line = buffers[stream].slice(0, i);
      const isCr = buffers[stream][i] === '\r';
      const isCrlf = isCr && buffers[stream][i + 1] === '\n';
      // Bare \r = progress rewrite (steamcmd), \r\n or \n = real line
      const rewrite = isCr && !isCrlf;
      buffers[stream] = buffers[stream].slice(i + (isCrlf ? 2 : 1));
      if (line.trim()) onLine(stream, line, rewrite);
      i = buffers[stream].search(/\r|\n/);
    }
  };
  const flushStream = (stream: 'stdout' | 'stderr') => {
    if (onLine && buffers[stream].trim()) onLine(stream, buffers[stream], false);
    buffers[stream] = '';
  };

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
            settled = true;
            reject(new Error(`Commande expirée après ${options.timeoutMs}ms : ${file} ${args.join(' ')}`));
          }
        }, options.timeoutMs)
      : null;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      emitLines('stdout', text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      emitLines('stderr', text);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Unterminated tail (process killed mid-line) — emit before settling
      flushStream('stdout');
      flushStream('stderr');
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Runs a command in a shell, with optional timeout.
 * On Windows: cmd /c; otherwise: /bin/sh -c.
 * Used by the install runner for the `command` and `script` actions
 * of plugins (e.g. java, steamcmd, powershell).
 */
export function exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['/c', command] : ['-c', command];
  return spawnChild(shell, shellArgs, options);
}

/**
 * Runs a binary with its arguments (direct spawn, NO shell).
 * Node escapes quotes the MSVCRT way (`\"`) in arguments —
 * cmd.exe does not understand that escaping. Passing a shell command as a
 * string therefore corrupts quoted paths (e.g. `powershell -File "C:\…"` →
 * "Illegal characters in path"). With an argument array,
 * each argument is properly quoted: paths with
 * spaces or quotes pass through intact.
 */
export function execProcess(
  file: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return spawnChild(file, args, options);
}

/**
 * Tails a log file while a command runs and streams new lines via onLine.
 *
 * Why: console tools like steamcmd stay SILENT when stdout is a pipe (they
 * only print progress on a real terminal) but write it to a log file as it
 * happens. The agent polls the file and emits the new lines live — no PTY,
 * no extra dependency.
 *
 * - starts at the file's CURRENT size (a pre-existing file is not replayed)
 * - survives the file being created later, truncated or rotated
 * - only complete lines are emitted (a partial trailing line is carried
 *   until its newline arrives, flushed once when the command exits)
 */
function startLogTail(
  tail: NonNullable<CommandAction['tail']>,
  ctx: ActionContext,
  onLine: ExecOptions['onLine'],
): { stop: () => Promise<void> } {
  const filePath = resolvePath(ctx.installDir, render(tail.file, ctx.vars));
  const filter = tail.filter ? new RegExp(tail.filter) : null;
  const intervalMs = tail.intervalMs ?? 1000;

  // Pre-existing file → only stream what the command APPENDS
  let offset = existsSync(filePath) ? statSync(filePath).size : 0;
  let pending = '';
  let stopped = false;

  const emitLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (filter && !filter.test(line)) return;
    onLine?.('stdout', line, false);
  };

  const readNewLines = async () => {
    if (stopped) return;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(filePath, 'r');
      const size = (await handle.stat()).size;
      if (size < offset) offset = 0; // truncated/rotated
      if (size > offset) {
        const length = size - offset;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        offset = size;
        pending += buffer.toString('utf8');
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? ''; // keep the unterminated tail
        for (const line of lines) emitLine(line);
      }
    } catch {
      // Not created yet or racing a write — the next tick retries
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };

  const timer = setInterval(() => void readNewLines(), intervalMs);

  return {
    /** Final flush when the command exits (catches the trailing lines). */
    async stop() {
      clearInterval(timer);
      await readNewLines(); // stopped=false → the last poll actually reads
      stopped = true;
      if (pending.trim()) emitLine(pending);
      pending = '';
    },
  };
}

/**
 * `command` action: runs a binary in the install directory.
 * Failure (non-success code) = install error.
 * Resolved variables (plugin + system) are injected into the environment.
 * Returns the exec result (stdout/stderr) for the install log.
 */
export async function runCommand(
  action: CommandAction,
  ctx: ActionContext,
  onLine?: ExecOptions['onLine'],
): Promise<ExecResult> {
  const command = render(action.command, ctx.vars);
  const cwd = action.cwd
    ? resolvePath(ctx.installDir, render(action.cwd, ctx.vars))
    : ctx.installDir;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(action.env ?? {})) {
    env[key] = render(value, ctx.vars);
  }
  for (const [key, value] of ctx.vars) {
    env[key] = value;
  }

  // Live progress: tail the log file the command writes, if declared
  const tail = action.tail ? startLogTail(action.tail, ctx, onLine) : null;
  try {
    const result = await exec(command, { cwd, env, timeoutMs: action.timeoutMs, onLine });
    // successCodes: some tools exit with a benign code on success paths
    // (steamcmd: 7 after its self-update) — default success is 0 only.
    const successCodes = action.successCodes ?? [0];
    if (result.code === null || !successCodes.includes(result.code)) {
      const details = result.stderr.trim() || result.stdout.trim();
      throw new Error(
        `Commande échouée (code ${result.code}) : ${command}${details ? `\n${details}` : ''}`,
      );
    }
    return result;
  } finally {
    await tail?.stop();
  }
}

/**
 * `script` action: runs a script via the requested shell (bash/powershell/cmd).
 * The content is templated then written to a temporary file.
 * Direct spawn with an argument array — never via cmd /c as a string (see execProcess).
 * Returns the exec result (stdout/stderr) for the install log.
 */
export async function runScript(
  action: ScriptAction,
  ctx: ActionContext,
  onLine?: ExecOptions['onLine'],
): Promise<ExecResult> {
  const content = render(action.content, ctx.vars);

  const scriptDir = await mkdtemp(join(tmpdir(), 'mojito-script-'));
  const extensions: Record<string, string> = {
    bash: '.sh',
    powershell: '.ps1',
    cmd: '.cmd',
  };
  const scriptPath = join(scriptDir, `script${extensions[action.shell] ?? '.txt'}`);

  // Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI — UTF-8 content
  // with accents (FR messages) would be corrupted. UTF-8 BOM for powershell.
  const fileContent = action.shell === 'powershell' ? `\ufeff${content}` : content;
  await writeFile(scriptPath, fileContent, 'utf-8');

  try {
    const options: ExecOptions = { cwd: ctx.installDir, timeoutMs: action.timeoutMs, onLine };
    let result: ExecResult;
    if (action.shell === 'powershell') {
      result = await execProcess(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        options,
      );
    } else if (action.shell === 'bash') {
      result = await execProcess('bash', [scriptPath], options);
    } else {
      result = await execProcess(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', scriptPath], options);
    }

    if (result.code !== 0) {
      const details = result.stderr.trim() || result.stdout.trim();
      throw new Error(`Script échoué (code ${result.code})${details ? `\n${details}` : ''}`);
    }
    return result;
  } finally {
    await rm(scriptDir, { recursive: true, force: true });
  }
}
