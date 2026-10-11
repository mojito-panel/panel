import {
  findToolFeatureErrors,
  findUnknownVariables,
  validateVariableValue,
  type Recipe,
  type RunnerAction,
} from '@mojito/contract';
import { mkdir } from 'node:fs/promises';
import { resolveVariables, render, type SystemVariables } from '../templating';
import {
  buildToolEnv,
  countToolSteps,
  ensureTool,
  resolveRecipeTools,
  runSteamcmdContentInstall,
} from '../../tools';
import type { EnsureToolResult } from '../../tools';
import type { ActionContext } from './context';
import { runWrite } from './actions/write';
import { runReplace } from './actions/replace';
import { runConfigFile } from './actions/config-file';
import { runDownload } from './actions/download';
import { runExtract } from './actions/extract';
import { runCommand, runScript, type ExecOptions } from './actions/exec';

export interface InstallOptions {
  recipe: Recipe;
  /** Server variable values (override recipe defaults). */
  variables: Record<string, string | number | boolean>;
  /** System variables provided by the agent. */
  systemVariables: SystemVariables;
  /** Server install directory. */
  installDir: string;
  /** Progress callback (compatible with the contract's installProgress). */
  onProgress?: (progress: InstallProgress) => void;
  /** Detailed install events — step starts, command output, results. */
  onEvent?: (event: InstallEvent) => void;
}

export interface InstallProgress {
  step: number;
  totalSteps: number;
  message: string;
  percent: number;
}

/**
 * Fine-grained install event (debug trail streamed to the panel).
 * step-output.rewrite: true = progress-bar rewrite of the previous rewrite
 * line (bare \r, e.g. steamcmd download %) — the consumer replaces, not appends.
 */
export type InstallEvent =
  | { type: 'step-start'; step: number; totalSteps: number; message: string }
  | { type: 'step-output'; step: number; stream: 'stdout' | 'stderr'; text: string; rewrite: boolean }
  | { type: 'step-done'; step: number; message: string };

export interface InstallResult {
  success: boolean;
  error?: string;
  resolvedVars: Map<string, string>;
}

/** Readable messages for each action type. */
function describeAction(action: RunnerAction): string {
  switch (action.action) {
    case 'download':
      return `Téléchargement de ${action.dest}`;
    case 'extract':
      return `Extraction de ${action.archive}`;
    case 'write':
      return `Écriture de ${action.file}`;
    case 'replace':
      return `Modification de ${action.file}`;
    case 'configFile':
      return `Configuration de ${action.file} (${action.parser})`;
    case 'command':
      return `Exécution : ${action.command}`;
    case 'script':
      return `Exécution du script ${action.shell}`;
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} Mo`
    : `${bytes} octets`;
}

/**
 * Upfront validation (unknown variables + values) — the router calls this
 * BEFORE starting a background install so the panel gets an immediate
 * 400/422 instead of a delayed failure.
 */
export function validateInstall(
  recipe: Recipe,
  variables: Record<string, string | number | boolean>,
): string | null {
  const unknown = findUnknownVariables(recipe);
  if (unknown.length > 0) {
    return `Variables inconnues dans la recette : ${unknown.join(', ')}`;
  }

  const toolErrors = findToolFeatureErrors(recipe);
  if (toolErrors.length > 0) {
    return toolErrors.join(' ; ');
  }

  for (const variable of recipe.variables) {
    const value = variables[variable.env];
    if (value !== undefined) {
      const error = validateVariableValue(variable, value);
      if (error) {
        return error;
      }
    }
  }
  return null;
}

/** Live step-output emitter for the current step (streamed line by line). */
function stepOutputEmitter(
  onEvent: InstallOptions['onEvent'],
  step: number,
): ExecOptions['onLine'] {
  if (!onEvent) return undefined;
  return (stream, text, rewrite) => onEvent({ type: 'step-output', step, stream, text, rewrite });
}

/**
 * Runs a recipe's install actions, step by step,
 * with strict variable validation before starting.
 */
export async function runInstall(options: InstallOptions): Promise<InstallResult> {
  const { recipe, variables, systemVariables, installDir, onProgress, onEvent } = options;

  // 1. Strict validation: unknown variable = install error
  const upfrontError = validateInstall(recipe, variables);
  if (upfrontError) {
    return { success: false, error: upfrontError, resolvedVars: new Map() };
  }

  // 2. Resolve variables
  const resolvedVars = resolveVariables(recipe, variables, systemVariables);

  // 3. Prepare the install directory
  await mkdir(installDir, { recursive: true });

  const toolStepCount = countToolSteps(recipe);
  const totalSteps = toolStepCount + recipe.install.length;

  const emitStepStart = (step: number, message: string) => {
    onProgress?.({
      step,
      totalSteps,
      message,
      percent: Math.round((step / Math.max(totalSteps, 1)) * 100),
    });
    onEvent?.({ type: 'step-start', step, totalSteps, message });
  };

  // 4. Prebuilt tools (agent cache, shared between servers): ensure present,
  //    then steamcmd installs the game content itself (+app_update <appId>)
  let toolEnv: Record<string, string> | undefined;
  let step = 0;
  if (toolStepCount > 0) {
    const tools = resolveRecipeTools(recipe, resolvedVars);
    const runtimes: EnsureToolResult[] = [];
    try {
      for (const tool of tools) {
        emitStepStart(step, `Préparation de l'outil ${tool.label}`);
        const runtime = await ensureTool(tool, {
          installDir,
          onLine: stepOutputEmitter(onEvent, step),
        });
        runtimes.push(runtime);
        onEvent?.({
          type: 'step-done',
          step,
          message: runtime.installed ? 'installé dans .bin du serveur' : 'déjà installé',
        });
        step++;
      }

      const steamIndex = tools.findIndex((t) => t.name === 'steamcmd' && t.steamcmd);
      if (steamIndex !== -1) {
        const { appId, mod } = tools[steamIndex].steamcmd!;
        const steamRuntime = runtimes[steamIndex];
        // Two passes: the first download can be partial (well-known SteamCMD
        // bug, GoldSrc app 90 in particular) — the `validate` pass completes
        // and integrity-checks the content
        const passes: { validate: boolean; message: string }[] = [
          { validate: false, message: `Installation du contenu Steam (app ${appId})` },
          { validate: true, message: `Vérification du contenu Steam (app ${appId})` },
        ];
        for (const pass of passes) {
          emitStepStart(step, pass.message);
          await runSteamcmdContentInstall(
            { appId, mod, validate: pass.validate },
            steamRuntime.binDir,
            {
              installDir,
              onLine: stepOutputEmitter(onEvent, step),
            },
          );
          onEvent?.({ type: 'step-done', step, message: 'contenu installé' });
          step++;
        }
      }

      toolEnv = buildToolEnv(runtimes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Outil — ${message}`, resolvedVars };
    }
  }

  const ctx: ActionContext = { installDir, vars: resolvedVars, toolEnv };

  // 5. Run the actions (numbering continues after the actually-consumed tool steps)
  const actionOffset = step;
  for (let actionStep = 0; actionStep < recipe.install.length; actionStep++) {
    const action = recipe.install[actionStep];
    step = actionOffset + actionStep;
    const startMessage = render(describeAction(action), resolvedVars);
    emitStepStart(step, startMessage);

    try {
      let doneMessage: string;
      switch (action.action) {
        case 'download': {
          const bytes = await runDownload(action, ctx);
          doneMessage = formatBytes(bytes);
          break;
        }
        case 'extract': {
          const files = await runExtract(action, ctx);
          doneMessage = `${files} fichier(s) extrait(s)`;
          break;
        }
        case 'write': {
          doneMessage = await runWrite(action, ctx);
          break;
        }
        case 'replace': {
          doneMessage = await runReplace(action, ctx);
          break;
        }
        case 'configFile': {
          doneMessage = await runConfigFile(action, ctx);
          break;
        }
        case 'command': {
          const result = await runCommand(action, ctx, stepOutputEmitter(onEvent, step));
          doneMessage = `terminé (code ${result.code})`;
          break;
        }
        case 'script': {
          const result = await runScript(action, ctx, stepOutputEmitter(onEvent, step));
          doneMessage = `terminé (code ${result.code})`;
          break;
        }
      }
      onEvent?.({ type: 'step-done', step, message: doneMessage });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Étape ${step + 1} — ${message}`, resolvedVars };
    }
  }

  onProgress?.({
    step: totalSteps,
    totalSteps,
    message: 'Installation terminée',
    percent: 100,
  });

  return { success: true, resolvedVars };
}
