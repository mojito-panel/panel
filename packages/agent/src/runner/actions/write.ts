import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../templating';
import { resolvePath, type ActionContext } from '../context';

type WriteAction = RunnerActionInput & { action: 'write' };

/**
 * Action `write` : ecrit un fichier (contenu templatise), cree les dossiers parents.
 */
export async function runWrite(action: WriteAction, ctx: ActionContext): Promise<void> {
  const filePath = resolvePath(ctx.installDir, render(action.file, ctx.vars));
  const content = render(action.content, ctx.vars);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}
