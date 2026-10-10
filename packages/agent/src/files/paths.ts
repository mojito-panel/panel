import { resolve, sep } from 'node:path';

/**
 * Invalid or unsafe relative path (directory traversal, drive letter,
 * forbidden Windows characters) — maps to HTTP 400 `invalid_path`.
 */
export class InvalidPathError extends Error {
  constructor(message = 'Chemin invalide') {
    super(message);
    this.name = 'InvalidPathError';
  }
}

const FORBIDDEN_CHARS = /[\0<>:"|?*]/;

/**
 * Resolves a RELATIVE path (POSIX-style, from the browser's file manager)
 * inside a server's installDir — the single security gate of the file API.
 *
 * Rejected: absolute paths, `..` segments (no legitimate use — paths are
 * always rooted at the server root), drive letters (`C:`, UNC `\\server`),
 * and Windows-forbidden characters. Backslashes are normalized to `/` so
 * the panel always speaks POSIX, whatever the host.
 *
 * Returns the ABSOLUTE host path, guaranteed inside installDir.
 */
export function resolveServerPath(installDir: string, relativePath: string): string {
  if (typeof relativePath !== 'string') {
    throw new InvalidPathError();
  }

  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter((s) => s.length > 0);

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new InvalidPathError('Chemin interdit (traversée de dossier)');
    }
    if (/^[a-zA-Z]:/.test(segment)) {
      throw new InvalidPathError('Chemin interdit (lettre de lecteur)');
    }
    if (FORBIDDEN_CHARS.test(segment)) {
      throw new InvalidPathError('Caractère interdit dans le chemin');
    }
  }

  const root = resolve(installDir);
  const target = resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + sep)) {
    // Backstop: nothing should reach here after the segment checks
    throw new InvalidPathError('Chemin hors du dossier du serveur');
  }
  return target;
}

/**
 * Builds the relative POSIX path (as exposed by the file API) of a host
 * path inside installDir: `dir/sub/file.txt`. Root → ''.
 */
export function toRelativePosix(installDir: string, absolutePath: string): string {
  const root = resolve(installDir);
  const relative = absolutePath === root ? '' : absolutePath.slice(root.length + 1);
  return relative.split(sep).join('/');
}

/** POSIX join of a relative directory and a name (both already sanitized). */
export function joinRelative(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}
