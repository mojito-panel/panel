import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../templating';
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
function spawnChild(
  file: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<ExecResult> {
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    windowsHide: true,
  });

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
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
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
export function exec(
  command: string,
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ExecResult> {
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
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return spawnChild(file, args, options);
}

/**
 * `command` action: runs a binary in the install directory.
 * Failure (non-zero code) = install error.
 * Resolved variables (plugin + system) are injected into the environment.
 */
export async function runCommand(action: CommandAction, ctx: ActionContext): Promise<void> {
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

  const result = await exec(command, { cwd, env, timeoutMs: action.timeoutMs });
  if (result.code !== 0) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `Commande échouée (code ${result.code}) : ${command}${details ? `\n${details}` : ''}`,
    );
  }
}

/**
 * `script` action: runs a script via the requested shell (bash/powershell/cmd).
 * The content is templated then written to a temporary file.
 * Direct spawn with an argument array — never via cmd /c as a string (see execProcess).
 */
export async function runScript(action: ScriptAction, ctx: ActionContext): Promise<void> {
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
    const options = { cwd: ctx.installDir, timeoutMs: action.timeoutMs };
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
  } finally {
    await rm(scriptDir, { recursive: true, force: true });
  }
}
