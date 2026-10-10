import { isAbsolute, join, normalize, sep } from 'node:path';
import type { ResolvedVariables } from './templating';

/** Contexte partagé par toutes les actions du runner. */
export interface ActionContext {
  /** Dossier d'installation du serveur. */
  installDir: string;
  /** Variables résolues (système + serveur + defaults + env fixe). */
  vars: ResolvedVariables;
}

/**
 * Résout un chemin relatif au dossier d'installation.
 * Un chemin absolu est utilisé tel quel ; un chemin relatif est join à installDir.
 * Refuse les chemins qui s'échappent du dossier d'installation (sécurité).
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
