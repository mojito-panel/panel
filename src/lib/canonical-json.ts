/**
 * Canonical JSON serialization — deterministic output for content hashing.
 *
 * Object keys are sorted recursively (arrays keep their order) and no
 * whitespace is emitted, so two JSON documents that differ only by
 * formatting or key order produce the SAME canonical form. The marketplace
 * hashes this form to detect upstream recipe changes regardless of how the
 * author formats the file (and regardless of the panel re-serializing the
 * recipe on import — `upsertRecipe` stores the PARSED object).
 */

/** Serializes any JSON value to its canonical form (sorted keys, minified). */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}
