import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import AdmZip from 'adm-zip';
import type { z } from 'zod';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../../templating';
import { resolvePath, type ActionContext } from '../context';

type ExtractAction = RunnerActionInput & { action: 'extract' };

/**
 * Validates and resolves the path of a zip archive entry.
 * Rejects path traversal (`..` segments, absolute paths, Windows backslashes).
 * `stripComponents` removes N root folder levels (like tar --strip-components).
 */
export function resolveZipEntryPath(
  destDir: string,
  entryName: string,
  stripComponents?: number,
): string {
  // Zips use / but some tools write backslashes
  const normalizedEntry = entryName.replace(/\\/g, '/');
  const parts = normalizedEntry.split('/');

  if (parts.some((p) => p === '..' || p === '')) {
    throw new Error(`Entrée d'archive invalide (path traversal) : ${entryName}`);
  }

  const stripped =
    stripComponents && stripComponents > 0
      ? parts.slice(stripComponents)
      : parts;

  if (stripped.length === 0) {
    throw new Error(`Entrée d'archive vidée par stripComponents : ${entryName}`);
  }

  const targetPath = join(destDir, ...stripped);
  const normalizedDest = normalize(destDir);

  if (isAbsolute(entryName) || !normalize(targetPath).startsWith(normalizedDest + sep)) {
    throw new Error(`Entrée d'archive hors du dossier de destination : ${entryName}`);
  }

  return targetPath;
}

/**
 * `extract` action: extracts a zip archive into a destination directory.
 * Returns the number of files extracted (install log).
 */
export async function runExtract(action: ExtractAction, ctx: ActionContext): Promise<number> {
  const archivePath = resolvePath(ctx.installDir, render(action.archive, ctx.vars));
  const destDir = resolvePath(ctx.installDir, render(action.dest, ctx.vars));

  await mkdir(destDir, { recursive: true });

  const zip = new AdmZip(archivePath);

  let files = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    const targetPath = resolveZipEntryPath(destDir, entry.entryName, action.stripComponents);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.getData());
    files++;
  }
  return files;
}
