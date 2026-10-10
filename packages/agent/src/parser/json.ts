import { setPath } from './yaml';

/** json parser: `a.b.c` paths → nested objects, preserves the rest of the document. */
export function applyJson(content: string, find: Record<string, string>): string {
  const doc = JSON.parse(content) as Record<string, unknown>;
  for (const [path, value] of Object.entries(find)) {
    setPath(doc, path, value);
  }
  return JSON.stringify(doc, null, 2);
}
