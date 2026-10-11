import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { glob } from 'fast-glob';
import * as tar from 'tar';
import type { ReadEntry } from 'tar';
import { validateBackupIncludePattern } from '@mojito/contract';
import { resolveServerPath } from '../../files/paths';

/**
 * Backup service (≈ wings server/backup): tar.gz archives of a server's
 * install dir, stored OUTSIDE it (`dataDir/backups/<serverId>/`) so they
 * never appear in the file browser and survive a restore-truncate.
 *
 * Unlike Pelican (whole data dir + user-supplied ignore patterns), the
 * recipe DECLARES what a backup contains: glob include patterns validated
 * by the contract, expanded here with two containment gates:
 * 1. glob expansion with symlink following DISABLED (the classic glob
 *    escape) and `..`-free patterns,
 * 2. every match re-checked through `resolveServerPath` before it enters
 *    the archive — an escape aborts the backup, it is never skipped.
 * The agent's own `.bin/` tool directory is ALWAYS excluded.
 */

export type BackupErrorCode = 'no_match' | 'invalid_path' | 'not_found' | 'failed';

/** Backup operation failure — `code` maps to an HTTP status by the router. */
export class BackupError extends Error {
  readonly code: BackupErrorCode;

  constructor(message: string, code: BackupErrorCode = 'failed') {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

/** Absolute path of one server's backup archive. */
export function backupArchivePath(backupDir: string, serverId: string, backupId: string): string {
  return join(backupDir, serverId, `${backupId}.tar.gz`);
}

/** True when the archive file exists on the disk. */
export async function backupArchiveExists(
  backupDir: string,
  serverId: string,
  backupId: string,
): Promise<boolean> {
  try {
    const st = await stat(backupArchivePath(backupDir, serverId, backupId));
    return st.isFile();
  } catch {
    return false;
  }
}

/** The agent's own tool directory — provisioned at install, never archived. */
const AGENT_BIN_DIR = '.bin';

/**
 * Expands include patterns into archive entry points — RELATIVE POSIX
 * paths (files or directories) guaranteed inside installDir. Directories
 * are kept as entry points (the tar recurses into them); entries that
 * live under another matched directory are dropped to avoid duplicates.
 */
export async function expandBackupEntries(
  installDir: string,
  include?: string[],
): Promise<string[]> {
  for (const pattern of include ?? []) {
    const error = validateBackupIncludePattern(pattern);
    if (error) throw new BackupError(error, 'invalid_path');
    // An explicit .bin pattern is refused outright (clearer than a silent skip).
    if (pattern === AGENT_BIN_DIR || pattern.startsWith(`${AGENT_BIN_DIR}/`)) {
      throw new BackupError(
        'Le dossier .bin de l’agent ne peut pas être sauvegardé',
        'invalid_path',
      );
    }
  }

  // No recipe config → whole install dir, top-level entries only.
  const patterns = include && include.length > 0 ? include : ['*'];

  const matches = await glob(patterns, {
    cwd: installDir,
    dot: true,
    onlyFiles: false,
    // Symlink escape gate: a symlink may be listed but never traversed.
    followSymbolicLinks: false,
    suppressErrors: false,
  });

  // The agent's tool dir never enters an archive, whatever matched it.
  const unique = [...new Set(matches)]
    .filter((entry) => entry !== AGENT_BIN_DIR && !entry.startsWith(`${AGENT_BIN_DIR}/`))
    .sort();

  // Containment backstop: every match must resolve inside installDir.
  for (const entry of unique) {
    try {
      resolveServerPath(installDir, entry);
    } catch {
      throw new BackupError(
        `Chemin de sauvegarde hors du dossier du serveur : ${entry}`,
        'invalid_path',
      );
    }
  }

  // Directories matched by a pattern make their matched children redundant.
  const dirs = new Set<string>();
  for (const entry of unique) {
    const st = await stat(join(installDir, entry));
    if (st.isDirectory()) dirs.add(entry);
  }
  const entries = unique.filter(
    (entry) => ![...dirs].some((dir) => entry !== dir && entry.startsWith(`${dir}/`)),
  );

  if (entries.length === 0) {
    throw new BackupError('Aucun fichier à sauvegarder ne correspond aux motifs', 'no_match');
  }
  return entries;
}

export interface CreateBackupResult {
  sizeBytes: number;
  /** SHA-256 of the archive (hex). */
  checksum: string;
}

/** Creates a tar.gz archive of the matched entries (streams to disk). */
export async function createBackupArchive(options: {
  installDir: string;
  backupDir: string;
  serverId: string;
  backupId: string;
  include?: string[];
}): Promise<CreateBackupResult> {
  const { installDir, backupDir, serverId, backupId, include } = options;
  const entries = await expandBackupEntries(installDir, include);
  const archivePath = backupArchivePath(backupDir, serverId, backupId);

  await mkdir(dirname(archivePath), { recursive: true });

  try {
    await tar.c(
      { cwd: installDir, file: archivePath, gzip: true, strict: true, portable: true },
      entries,
    );
  } catch (err) {
    // A half-written archive must not survive a failed create.
    await rm(archivePath, { force: true });
    throw new BackupError(`Échec de la création de l’archive : ${errorMessage(err)}`, 'failed');
  }

  const st = await stat(archivePath);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archivePath)) {
    hash.update(chunk as Buffer);
  }

  return { sizeBytes: st.size, checksum: hash.digest('hex') };
}

/**
 * Validates one archive entry name before extraction — the tar equivalent
 * of the file API's `resolveServerPath`. Rejects path traversal, absolute
 * paths, drive letters, the agent's `.bin/` and Windows-forbidden chars;
 * anything suspicious ABORTS the restore (never silently skipped).
 */
function validateArchiveEntry(installDir: string, entryName: string): void {
  const normalized = entryName.replace(/\\/g, '/');
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  // Root entries ('', './') carry no file — nothing to check.
  const segments = trimmed.split('/').filter((s) => s.length > 0 && s !== '.');
  if (segments.length === 0) return;

  try {
    resolveServerPath(installDir, segments.join('/'));
  } catch {
    throw new BackupError(`Entrée d’archive invalide : ${entryName}`, 'invalid_path');
  }
  if (segments[0] === AGENT_BIN_DIR) {
    throw new BackupError('L’archive tente d’écraser le dossier .bin de l’agent', 'invalid_path');
  }
}

/** Wipes the install dir, preserving the agent's own `.bin/` tool directory. */
async function truncateInstallDir(installDir: string): Promise<void> {
  const entries = await readdir(installDir);
  for (const entry of entries) {
    if (entry === AGENT_BIN_DIR) continue;
    await rm(join(installDir, entry), { recursive: true, force: true });
  }
}

/**
 * Restores an archive onto the server dir: optional truncate (files absent
 * from the archive are LOST), then extraction. Every entry is validated in
 * a pre-pass BEFORE anything is written to the disk.
 */
export async function restoreBackupArchive(options: {
  installDir: string;
  backupDir: string;
  serverId: string;
  backupId: string;
  truncate: boolean;
}): Promise<void> {
  const { installDir, backupDir, serverId, backupId, truncate } = options;
  const archivePath = backupArchivePath(backupDir, serverId, backupId);

  if (!(await backupArchiveExists(backupDir, serverId, backupId))) {
    throw new BackupError('Sauvegarde introuvable sur ce node', 'not_found');
  }

  if (truncate) {
    await truncateInstallDir(installDir);
  }
  await mkdir(installDir, { recursive: true });

  // Safety pre-pass: collect then validate EVERY entry before writing a
  // single file (a throw inside `onentry` would not reject the stream).
  try {
    const names: string[] = [];
    await tar.list({
      file: archivePath,
      strict: true,
      onentry: (entry: ReadEntry) => {
        names.push(entry.path);
      },
    });
    for (const name of names) {
      validateArchiveEntry(installDir, name);
    }
    await tar.x({ cwd: installDir, file: archivePath, strict: true });
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError(`Échec de la restauration : ${errorMessage(err)}`, 'failed');
  }
}

/** Removes an archive — refuses when it does not exist. */
export async function removeBackupArchive(
  backupDir: string,
  serverId: string,
  backupId: string,
): Promise<void> {
  const archivePath = backupArchivePath(backupDir, serverId, backupId);
  if (!(await backupArchiveExists(backupDir, serverId, backupId))) {
    throw new BackupError('Sauvegarde introuvable sur ce node', 'not_found');
  }
  await rm(archivePath, { force: true });
  // Like wings: drop the server's backup dir once it is empty.
  const dir = dirname(archivePath);
  const remaining = await readdir(dir);
  if (remaining.length === 0) {
    await rmdir(dir).catch(() => undefined);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
