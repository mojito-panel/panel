/**
 * Stored recipe normalization (panel DB → contract v1).
 *
 * Recipes saved before the v1 cutover carry `schemaVersion: 2|3` and (for
 * v2) no `type` — both shapes are structurally compatible with the v1
 * schemas (the only v1 additions are the version bump and the mandatory
 * `type`), so they are upgraded IN MEMORY wherever a stored recipe leaves
 * the panel: the edit page's JSON (getRecipeFn), the install/reinstall
 * pushes to the agent and the resolved runtime recipes. Editing a legacy
 * recipe (or re-importing its file) writes v1 back to the DB.
 */

/**
 * Upgrades a stored recipe JSON to the v1 contract: schemaVersion → 1 and
 * `type` defaulted to "app" when absent (v2 recipes are all apps; runtime
 * recipes carry their own type). Already-v1 recipes are returned as-is.
 */
export function normalizeStoredRecipe<T extends Record<string, unknown>>(
  json: T,
): T {
  if (json.schemaVersion === 1) return json;
  return { ...json, schemaVersion: 1, type: (json.type as string) ?? 'app' };
}
