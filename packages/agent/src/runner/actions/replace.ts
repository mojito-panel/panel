import { readFile, writeFile } from 'node:fs/promises';
import type { z } from 'zod';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../templating';
import { resolvePath, type ActionContext } from '../context';

type ReplaceAction = RunnerActionInput & { action: 'replace' };

/**
 * Action `replace` : remplace une chaine (ou regex) dans un fichier existant.
 * `find` et `replace` sont templatises.
 */
export async function runReplace(action: ReplaceAction, ctx: ActionContext): Promise<void> {
  const filePath = resolvePath(ctx.installDir, render(action.file, ctx.vars));
  const content = await readFile(filePath, 'utf-8');
  const find = render(action.find, ctx.vars);
  const replaceWith = render(action.replace, ctx.vars);

  const newContent = action.regex
    ? content.replace(new RegExp(find, 'g'), replaceWith)
    : content.split(find).join(replaceWith);

  await writeFile(filePath, newContent, 'utf-8');
}
