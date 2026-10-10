import { parse, stringify } from 'yaml';

/** yaml parser: `a.b.c` paths → nested objects, preserves the rest of the document. */
export function applyYaml(content: string, find: Record<string, string>): string {
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

export { setPath };
