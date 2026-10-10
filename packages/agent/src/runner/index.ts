import {
  findUnknownVariables,
  validateVariableValue,
  type Plugin,
  type RunnerAction,
} from '@mojito/contract';
import { mkdir } from 'node:fs/promises';
import { resolveVariables, render, type SystemVariables } from './templating';
import type { ActionContext } from './context';
import { runWrite } from './actions/write';
import { runReplace } from './actions/replace';
import { runConfigFile } from './actions/config-file';
import { runDownload } from './actions/download';
import { runExtract } from './actions/extract';
import { runCommand, runScript } from './actions/exec';

export interface InstallOptions {
  plugin: Plugin;
  /** Valeurs des variables du serveur (override les defaults du plugin). */
  variables: Record<string, string | number | boolean>;
  /** Variables système fournies par l'agent. */
  systemVariables: SystemVariables;
  /** Dossier d'installation du serveur. */
  installDir: string;
  /** Callback de progression (compatible installProgress du contract). */
  onProgress?: (progress: InstallProgress) => void;
}

export interface InstallProgress {
  step: number;
  totalSteps: number;
  message: string;
  percent: number;
}

export interface InstallResult {
  success: boolean;
  error?: string;
  resolvedVars: Map<string, string>;
}

/** Messages lisibles pour chaque type d'action. */
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

/**
 * Exécute les actions d'installation d'un plugin, étape par étape,
 * avec validation stricte des variables avant de démarrer.
 */
export async function runInstall(options: InstallOptions): Promise<InstallResult> {
  const { plugin, variables, systemVariables, installDir, onProgress } = options;

  // 1. Validation stricte : variable inconnue = erreur à l'installation
  const unknown = findUnknownVariables(plugin);
  if (unknown.length > 0) {
    return {
      success: false,
      error: `Variables inconnues dans le plugin : ${unknown.join(', ')}`,
      resolvedVars: new Map(),
    };
  }

  // 2. Validation des valeurs des variables
  for (const variable of plugin.variables) {
    const value = variables[variable.env];
    if (value !== undefined) {
      const error = validateVariableValue(variable, value);
      if (error) {
        return { success: false, error, resolvedVars: new Map() };
      }
    }
  }

  // 3. Résolution des variables
  const resolvedVars = resolveVariables(plugin, variables, systemVariables);

  // 4. Préparation du dossier d'installation
  await mkdir(installDir, { recursive: true });

  const ctx: ActionContext = { installDir, vars: resolvedVars };
  const totalSteps = plugin.install.length;

  // 5. Exécution des actions
  for (let step = 0; step < totalSteps; step++) {
    const action = plugin.install[step];
    onProgress?.({
      step,
      totalSteps,
      message: render(describeAction(action), resolvedVars),
      percent: Math.round((step / Math.max(totalSteps, 1)) * 100),
    });

    try {
      switch (action.action) {
        case 'download':
          await runDownload(action, ctx);
          break;
        case 'extract':
          await runExtract(action, ctx);
          break;
        case 'write':
          await runWrite(action, ctx);
          break;
        case 'replace':
          await runReplace(action, ctx);
          break;
        case 'configFile':
          await runConfigFile(action, ctx);
          break;
        case 'command':
          await runCommand(action, ctx);
          break;
        case 'script':
          await runScript(action, ctx);
          break;
      }
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
