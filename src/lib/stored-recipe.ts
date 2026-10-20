/**
 * Stored recipe normalization (panel DB → contract v3).
 *
 * Recipes saved before the v3 cutover carry `schemaVersion: 1|2` and a
 * `type`/`requires` pair that no longer exists — the structural leftovers
 * are stripped IN MEMORY wherever a stored recipe leaves the panel (the
 * edit page's JSON, the install/reinstall pushes to the agent). Editing a
 * legacy recipe (or re-importing its file) writes v3 back to the DB.
 *
 * A legacy recipe still needs a `dockerImage` (new in v3, required):
 * when absent the push is left as-is and the agent rejects the install
 * with a validation error — the recipe must be rewritten for containers.
 */

/**
 * Upgrades a stored recipe JSON to the v3 contract shape: schemaVersion →
 * 3, legacy `type`/`requires` fields dropped. Already-v3 recipes are
 * returned as-is. `dockerImage` is NOT invented when missing (see header).
 */
export function normalizeStoredRecipe<T extends Record<string, unknown>>(
  json: T,
): T {
  if (json.schema_version === 3) return json;
  const { type: _type, requires: _requires, ...rest } = json;
  return { ...rest, schema_version: 3 } as unknown as T;
}
