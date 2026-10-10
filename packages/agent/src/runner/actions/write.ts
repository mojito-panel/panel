import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../templating';
import { resolvePath, type ActionContext } from '../context';

type WriteAction = RunnerActionInput & { action: 'write' };

/**
 * `write` action: writes a file (templated content), creates parent directories.
 */
export async function runWrite(action: WriteAction, ctx: ActionContext): Promise<void> {
  const filePath = resolvePath(ctx.installDir, render(action.file, ctx.vars));
  const content = render(action.content, ctx.vars);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}
