import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';
import { parse, stringify } from 'yaml';
import type { runnerActionSchema, RunnerActionInput } from '@mojito/contract';
import { render } from '../templating';
import { resolvePath, type ActionContext } from '../context';

type ConfigFileAction = RunnerActionInput & { action: 'configFile' };

/**
 * Action `configFile` : modification typée d'un fichier de config via un parser
 * (properties, ini, yaml, json). Équivalent `config.files` de Pelican.
 * Chaque valeur de `find` est templatisée avant écriture.
 * Un fichier absent est CRÉÉ avec les entrées de `find` (les parsers ajoutent
 * déjà les clés manquantes en fin de fichier) — ex: server.properties n'existe
 * pas avant le premier démarrage du serveur Minecraft.
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

/** key=value, commentaires #/!, préserve l'ordre et les clés non modifiées. */
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

  // Clés absentes du fichier : append à la fin
  for (const [key, value] of remaining) {
    result.push(`${key}=${value}`);
  }

  return result.join('\n');
}

/** Sections [section], clés `section.key` ou `key` (section courante implicite). */
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
      // clé sans section
      if (remaining.has(match[1])) {
        result.push(`${match[1]}=${remaining.get(match[1])}`);
        remaining.delete(match[1]);
        continue;
      }
    }
    result.push(line);
  }

  // Clés absentes : ajouter la section si besoin puis la clé
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

/** Chemins `a.b.c` → objets imbriqués, préserve le reste du document. */
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
