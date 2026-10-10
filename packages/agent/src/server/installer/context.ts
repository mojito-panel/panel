import { isAbsolute, join, normalize, sep } from 'node:path';
import type { ResolvedVariables } from '../templating';

/** Context shared by all runner actions. */
export interface ActionContext {
  /** Server install directory. */
  installDir: string;
  /** Resolved variables (system + server + defaults + fixed env). */
  vars: ResolvedVariables;
}

/**
 * Resolves a path relative to the install directory.
 * An absolute path is used as-is; a relative path is joined to installDir.
 * Rejects paths that escape the install directory (security).
 */
export function resolvePath(installDir: string, filePath: string): string {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  const resolved = normalize(join(installDir, filePath));
  const normalizedInstallDir = normalize(installDir);
  if (!resolved.startsWith(normalizedInstallDir + sep) && resolved !== normalizedInstallDir) {
    throw new Error(`Chemin hors du dossier d'installation : ${filePath}`);
  }
  return resolved;
}
