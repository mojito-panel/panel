/** ini parser: [section] sections, `section.key` or `key` keys (implicit current section). */
export function applyIni(content: string, find: Record<string, string>): string {
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
