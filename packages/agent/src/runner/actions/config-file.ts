import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';
import { parse, stringify } from 'yaml';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../templating';
import { resolvePath, type ActionContext } from '../context';

type ConfigFileAction = RunnerActionInput & { action: 'configFile' };

/**
 * `configFile` action: typed modification of a config file via a parser
 * (properties, ini, yaml, json). Equivalent of Pelican's `config.files`.
 * Each `find` value is templated before writing.
 * A missing file is CREATED with the `find` entries (parsers already
 * append missing keys at the end of the file) — e.g. server.properties does
 * not exist before the Minecraft server's first boot.
 */
export async function runConfigFile(action: ConfigFileAction, ctx: ActionContext): Promise<void> {
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

  const newContent = await applyParser(action.parser, content, templatedFind);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, newContent, 'utf-8');
}

// ─── Parser properties (server.properties, java .properties) ─────────────────

async function applyParser(
  parser: 'properties' | 'ini' | 'yaml' | 'json',
  content: string,
  find: Record<string, string>,
): Promise<string> {
  switch (parser) {
    case 'properties':
      return applyProperties(content, find);
    case 'ini':
      return applyIni(content, find);
    case 'yaml':
      return applyYaml(content, find);
    case 'json':
      return applyJson(content, find);
  }
}

/** key=value, #/! comments, preserves order and untouched keys. */
function applyProperties(content: string, find: Record<string, string>): string {
  const lines = content.split(/\r?\n/);
  const remaining = new Map(Object.entries(find));
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*([^=:#!\s][^=]*?)\s*=\s*(.*)$/);
    if (match && remaining.has(match[1])) {
      result.push(`${match[1]}=${remaining.get(match[1])}`);
      remaining.delete(match[1]);
    } else {
      result.push(line);
    }
  }

  // Keys missing from the file: append at the end
  for (const [key, value] of remaining) {
    result.push(`${key}=${value}`);
  }

  return result.join('\n');
}

/** [section] sections, `section.key` or `key` keys (implicit current section). */
function applyIni(content: string, find: Record<string, string>): string {
  const lines = content.split(/\r?\n/);
  const remaining = new Map(Object.entries(find));
  const result: string[] = [];
  let currentSection = '';

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[(.+)\]\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      result.push(line);
      continue;
    }

    const match = line.match(/^\s*([^=;#\s][^=]*?)\s*=\s*(.*)$/);
    if (match) {
      const fullKey = currentSection ? `${currentSection}.${match[1]}` : match[1];
      if (remaining.has(fullKey)) {
        result.push(`${match[1]}=${remaining.get(fullKey)}`);
        remaining.delete(fullKey);
        continue;
      }
      // key without section
      if (remaining.has(match[1])) {
        result.push(`${match[1]}=${remaining.get(match[1])}`);
        remaining.delete(match[1]);
        continue;
      }
    }
    result.push(line);
  }

  // Missing keys: add the section if needed, then the key
  const pendingBySection = new Map<string, Map<string, string>>();
  for (const [key, value] of remaining) {
    const dotIndex = key.indexOf('.');
    const section = dotIndex > -1 ? key.slice(0, dotIndex) : '';
    const subKey = dotIndex > -1 ? key.slice(dotIndex + 1) : key;
    if (!pendingBySection.has(section)) pendingBySection.set(section, new Map());
    pendingBySection.get(section)!.set(subKey, value);
  }
  for (const [section, entries] of pendingBySection) {
    if (section && !content.includes(`[${section}]`)) {
      result.push('', `[${section}]`);
    }
    for (const [key, value] of entries) {
      result.push(`${key}=${value}`);
    }
  }

  return result.join('\n');
}

/** `a.b.c` paths → nested objects, preserves the rest of the document. */
function applyYaml(content: string, find: Record<string, string>): string {
  const doc = parse(content) ?? {};
  for (const [path, value] of Object.entries(find)) {
    setPath(doc, path, coerceYaml(value));
  }
  return stringify(doc);
}

function coerceYaml(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function applyJson(content: string, find: Record<string, string>): string {
  const doc = JSON.parse(content) as Record<string, unknown>;
  for (const [path, value] of Object.entries(find)) {
    setPath(doc, path, value);
  }
  return JSON.stringify(doc, null, 2);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}
