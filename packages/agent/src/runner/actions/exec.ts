import { spawn } from 'node:child_process';
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
 * Exécute une commande dans un shell, avec timeout optionnel.
 * Sous Windows : cmd /c ; sinon : /bin/sh -c.
 * Utilisé par le runner d'installation pour les actions `command` et `script`
 * des plugins (ex: java, steamcmd, powershell).
 */
export function exec(
  command: string,
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];

    const child = spawn(shell, shellArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            child.kill('SIGKILL');
            settled = true;
            reject(new Error(`Commande expirée après ${options.timeoutMs}ms : ${command}`));
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
  await writeFile(scriptPath, content, 'utf-8');

  try {
    let command: string;
    if (action.shell === 'bash') {
      command = `bash "${scriptPath}"`;
    } else if (action.shell === 'powershell') {
      command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
    } else {
      command = `"${scriptPath}"`;
    }

    const result = await exec(command, { cwd: ctx.installDir, timeoutMs: action.timeoutMs });
    if (result.code !== 0) {
      const details = result.stderr.trim() || result.stdout.trim();
      throw new Error(`Script échoué (code ${result.code})${details ? `\n${details}` : ''}`);
    }
  } finally {
    await rm(scriptDir, { recursive: true, force: true });
  }
}
