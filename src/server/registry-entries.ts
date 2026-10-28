import { createHash } from 'node:crypto';
import { isRuntimeRecipeJson, parseRecipe, parseRuntimeRecipe } from '~/contract';
import { canonicalJson } from '~/lib/canonical-json';
import { recipeErrorMessage } from '~/lib/recipe-source';

/**
 * Registry catalog building (pure node — no ORM, no server-only marker, so
 * unit tests import it directly). The sync service clones a registry repo,
 * hands the recipe files to `buildRegistryEntries` and stores the result as
 * the registry's `entries` cache.
 */

/**
 * SHA-256 of a canonical JSON value — the content identity of a recipe.
 * Two recipe files that differ only by formatting or key order hash the
 * same, which is what makes the upstream diff formatting-independent.
 */
export function canonicalRecipeHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** SHA-256 of a raw string — identity of a file that does not parse. */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Recipe JSON file pattern — the recipes repo naming convention
 * (`<category>/<recipe>/recipe-<id>.json`). Anchored after a separator so
 * "myrecipe-x.json" does not match.
 */
export const RECIPE_FILE_PATTERN = /(^|\/)recipe-[^/\\]+\.json$/;

/** Upper bound per recipe file — same cap as a URL import. */
export const MAX_RECIPE_FILE_BYTES = 2_000_000;

/** One file read from a registry clone (POSIX path, raw content, optional cover). */
export interface RawRegistryFile {
  path: string;
  content: string;
  /** Vertical cover artwork (base64 data URL) — null when the repo ships none. */
  cover?: string | null;
}

/**
 * Builds the catalog entries of a registry from the files of its clone:
 * every `recipe-*.json` is parsed and validated against the contract, its
 * metadata (id, name, type, description) extracted and its canonical hash
 * computed. A file that fails validation stays in the catalog with its
 * `error` — the admin sees WHY it is not importable instead of a mystery.
 *
 * Entries are sorted by path (the recipes repo groups by category, so the
 * catalog reads grouped too).
 */
export function buildRegistryEntries(files: RawRegistryFile[]): import('~/lib/recipe-source').RegistryEntry[] {
  const entries: import('~/lib/recipe-source').RegistryEntry[] = [];

  for (const file of files) {
    if (!RECIPE_FILE_PATTERN.test(file.path)) continue;

    try {
      const parsed: unknown = JSON.parse(file.content);
      const recipe = isRuntimeRecipeJson(parsed) ? parseRuntimeRecipe(parsed) : parseRecipe(parsed);
      entries.push({
        path: file.path,
        sha: canonicalRecipeHash(recipe),
        slug: recipe.id,
        name: recipe.name,
        type: recipe.type === 'runtime' ? 'runtime' : null,
        description: recipe.description ?? null,
        error: null,
        cover: file.cover ?? null,
        content: file.content,
      });
    } catch (err) {
      entries.push({
        path: file.path,
        sha: sha256Text(file.content),
        slug: null,
        name: null,
        type: null,
        description: null,
        error: recipeErrorMessage(err),
        cover: file.cover ?? null,
        content: file.content,
      });
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}
