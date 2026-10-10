/** properties parser (server.properties, java .properties): key=value, #/! comments. */
export function applyProperties(content: string, find: Record<string, string>): string {
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
