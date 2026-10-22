/**
 * Stored recipe normalization (panel DB → contract v4).
 *
 * Recipes saved before the v4 cutover carry `schema_version: 3` and a
 * `docker_image`/`docker_images` pair that no longer exists — the
 * structural leftovers are stripped IN MEMORY wherever a stored recipe
 * leaves the panel (the edit page's JSON, the install/reinstall pushes
 * to the agent). Editing a legacy recipe (or re-importing its file)
 * writes v4 back to the DB.
 *
 * The runtimes an old recipe kept in its image (JDK, steamcmd) are NOT
 * provisioned automatically: the pushed recipe is left runnable-looking
 * but its install/start commands must be rewritten with declarative
 * download/extract actions — the agent rejects the install otherwise.
 */

/**
 * Upgrades a stored recipe JSON to the v4 contract shape: schema_version
 * → 4, legacy `docker_image`/`docker_images` fields dropped. Already-v4
 * recipes are returned as-is.
 */
export function normalizeStoredRecipe<T extends Record<string, unknown>>(
  json: T,
): T {
  if (json.schema_version === 4) return json;
  const {
    docker_image: _dockerImage,
    docker_images: _dockerImages,
    type: _type,
    requires: _requires,
    ...rest
  } = json;
  return { ...rest, schema_version: 4 } as unknown as T;
}
