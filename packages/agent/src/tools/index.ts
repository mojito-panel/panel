import { delimiter } from 'node:path';
import {
  JAVA_VERSION_ENV,
  STEAM_APP_ID_ENV,
  STEAM_MOD_ENV,
  type Recipe,
} from '@mojito/contract';
import type { ResolvedVariables } from '../server/templating';
import {
  ensureTool,
  type EnsureToolResult,
  type ResolvedRecipeTool,
  type ToolRuntime,
} from './registry';
import type { ExecOptions } from '../server/installer/actions/exec';

/**
 * Tool features — `features` entries the agent INTERPRETS (unlike the purely
 * descriptive ones: eula, pid_limit…). The tool is prebuilt inside the
 * SERVER's own `.bin/` (isolated per server), prepended to PATH at install
 * AND start.
 *
 * - `java`     → JDK in `.bin/java`, version from the JAVA_VERSION variable
 *                (declared by the recipe, overridable per server)
 * - `steamcmd` → SteamCMD in `.bin/steamcmd`; when the recipe declares
 *                STEAM_APP_ID, the agent runs the content install itself
 *                (+app_update, then a validate pass), with an optional
 *                STEAM_MOD variable (+app_set_config … mod <mod>)
 */

export { ensureTool, toolInstallDir } from './registry';
export type {
  EnsureToolOptions,
  EnsureToolResult,
  ResolvedRecipeTool,
  ToolRuntime,
} from './registry';
export { runSteamcmdContentInstall } from './steamcmd';

/** Resolves the recipe's tool features (parameters from resolved variables). */
export function resolveRecipeTools(
  recipe: Recipe,
  vars: ResolvedVariables,
): ResolvedRecipeTool[] {
  const tools: ResolvedRecipeTool[] = [];
  const hasFeature = (name: string) => recipe.features.includes(name);

  if (hasFeature('java')) {
    const version = vars.get(JAVA_VERSION_ENV);
    if (!version) {
      throw new Error(`La feature « java » requiert une valeur pour « ${JAVA_VERSION_ENV} »`);
    }
    tools.push({ name: 'java', key: version, label: `java ${version}` });
  }
  if (hasFeature('steamcmd')) {
    const appId = vars.get(STEAM_APP_ID_ENV);
    const mod = vars.get(STEAM_MOD_ENV);
    tools.push({
      name: 'steamcmd',
      key: '',
      label: 'steamcmd',
      steamcmd: appId ? { appId, mod } : undefined,
    });
  }
  return tools;
}

/**
 * Install steps contributed by the tool features:
 * ensure + (steamcmd content install: 2 passes when STEAM_APP_ID is declared).
 */
export function countToolSteps(recipe: Recipe): number {
  let steps = 0;
  if (recipe.features.includes('java')) steps += 1;
  if (recipe.features.includes('steamcmd')) {
    steps += 1;
    if (recipe.variables.some((v) => v.env === STEAM_APP_ID_ENV)) steps += 2;
  }
  return steps;
}

/** Ensures every resolved tool is in the server's `.bin/`, in declaration order. */
export async function ensureRecipeTools(
  tools: ResolvedRecipeTool[],
  installDir: string,
  onLine?: ExecOptions['onLine'],
): Promise<EnsureToolResult[]> {
  const runtimes: EnsureToolResult[] = [];
  for (const tool of tools) {
    runtimes.push(await ensureTool(tool, { installDir, onLine }));
  }
  return runtimes;
}

/**
 * Environment injection for install commands and the spawned server process:
 * tool bin dirs prepended to PATH + tool env (JAVA_HOME…).
 */
export function buildToolEnv(runtimes: ToolRuntime[]): Record<string, string> {
  const env: Record<string, string> = {};
  if (runtimes.length > 0) {
    const pathEntries = [...runtimes.map((r) => r.binDir), process.env.PATH ?? ''].filter(Boolean);
    env.PATH = pathEntries.join(delimiter);
  }
  for (const runtime of runtimes) Object.assign(env, runtime.env);
  return env;
}
