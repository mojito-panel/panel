import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunnerActionInput } from '@mojito/contract';
import { render } from '../../templating';
import { applyParser } from '../../../parser';
import { resolvePath, type ActionContext } from '../context';

type ConfigFileAction = RunnerActionInput & { action: 'configFile' };

/**
 * `configFile` action: typed modification of a config file via a parser
 * (properties, ini, yaml, json — src/parser/). Equivalent of Pelican's
 * `config.files`. Each `find` value is templated before writing.
 * A missing file is CREATED with the `find` entries (parsers already
 * append missing keys at the end of the file) — e.g. server.properties does
 * not exist before the Minecraft server's first boot.
 * Returns the resolved file path (install log).
 */
export async function runConfigFile(action: ConfigFileAction, ctx: ActionContext): Promise<string> {
  const filePath = resolvePath(ctx.installDir, render(action.file, ctx.vars));

  let content = '';
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const templatedFind: Record<string, string> = {};
  for (const [key, value] of Object.entries(action.find)) {
    templatedFind[key] = render(value, ctx.vars);
  }

  const newContent = applyParser(action.parser, content, templatedFind);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, newContent, 'utf-8');
  return filePath;
}
