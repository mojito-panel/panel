/**
 * Search-param serialization of the panel (TanStack Router configuration).
 *
 * The router's own query-string decoder CONVERTS values — `?status=true` arrives
 * as a boolean, `?q=123` as a number (see `qss.js#toValue`), and its JSON variant
 * does the same for anything that parses. List filters are validated in their
 * string wire form (`'true'`, `'123'`, `'a,b'`), so those values failed
 * validation and silently vanished from the URL.
 *
 * These two functions keep every value a STRING in both directions; the query
 * schemas coerce what they need (`z.coerce.number()` for paging), so one schema
 * still validates both the URL and the server-function payload.
 */

/** `?status=true&q=123` → `{ status: 'true', q: '123' }` (arrays for repeats). */
export function parseSearch(searchStr: string): Record<string, unknown> {
  const params = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr);
  const search: Record<string, unknown> = {};

  for (const [key, value] of params.entries()) {
    const existing = search[key];
    if (existing === undefined) search[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else search[key] = [existing, value];
  }

  return search;
}

/**
 * Writes primitives as-is (no JSON quoting), one entry per value of an array,
 * and drops absent/empty parameters so the URL only carries what is set.
 */
export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
      continue;
    }

    params.append(key, String(value));
  }

  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}
