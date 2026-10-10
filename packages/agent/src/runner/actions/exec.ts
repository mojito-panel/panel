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

/** Résultat d'une exécution de commande/script. */
export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn un processus, capture stdout/stderr, kill au timeout.
 * Base partagée de exec() (via shell) et execProcess() (spawn direct).
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
 * Exécute une commande dans un shell, avec timeout optionnel.
 * Sous Windows : cmd /c ; sinon : /bin/sh -c.
 * Utilisé par le runner d'installation pour les actions `command` et `script`
 * des plugins (ex: java, steamcmd, powershell).
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
 * Exécute un binaire avec ses arguments (spawn direct, SANS shell).
 * Node échappe les guillemets à la mode MSVCRT (`\"`) dans les arguments —
 * cmd.exe ne comprend pas cet échappement. Passer une commande shell en
 * chaîne corrompt donc les chemins cités (ex: `powershell -File "C:\…"` →
 * « Caractères non conformes dans le chemin d'accès »). Avec un tableau
 * d'arguments, chaque argument est cité proprement : les chemins avec
 * espaces ou guillemets passent intacts.
 */
export function execProcess(
  file: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return spawnChild(file, args, options);
}

/**
 * Action `command` : exécute un binaire dans le dossier d'installation.
 * Échec (code non nul) = erreur d'installation.
 * Les variables résolues (plugin + système) sont injectées dans l'environnement.
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
 * Action `script` : exécute un script via le shell demandé (bash/powershell/cmd).
 * Le contenu est templatisé puis écrit dans un fichier temporaire.
 * Spawn direct avec tableau d'arguments — jamais via cmd /c en chaîne (cf. execProcess).
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

  // Windows PowerShell 5.1 lit un .ps1 sans BOM comme de l'ANSI — un contenu
  // UTF-8 avec accents (messages FR) serait corrompu. BOM UTF-8 pour powershell.
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
