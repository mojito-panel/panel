import { createHash } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../templating';
import { resolvePath, type ActionContext } from '../context';

type DownloadAction = RunnerActionInput & { action: 'download' };

/**
 * Action `download` : telecharge un fichier (URL templatisee) avec verification
 * SHA-256 optionnelle et ecriture atomique (fichier .tmp puis rename).
 */
export async function runDownload(action: DownloadAction, ctx: ActionContext): Promise<void> {
  const url = render(action.url, ctx.vars);
  const dest = resolvePath(ctx.installDir, render(action.dest, ctx.vars));

  await mkdir(dirname(dest), { recursive: true });

  const response = await fetch(url, {
    headers: action.headers,
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Telechargement echoue (${response.status} ${response.statusText}) : ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (action.checksum) {
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (hash !== action.checksum.toLowerCase()) {
      throw new Error(
        `Checksum SHA-256 invalide pour ${dest} : attendu ${action.checksum}, obtenu ${hash}`,
      );
    }
  }

  // Ecriture atomique : .tmp puis rename
  const tmpPath = `${dest}.tmp`;
  await writeFile(tmpPath, buffer);
  try {
    await rename(tmpPath, dest);
  } catch {
    // Windows : rename peut echouer si le fichier existe deja
    await unlink(dest).catch(() => undefined);
    await rename(tmpPath, dest);
  }
}
