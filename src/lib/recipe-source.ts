import { ZodError } from 'zod';

/**
 * Recipe PROVENANCE (marketplace + URL imports) — PURE TypeScript, shared by
 * client and server.
 *
 * Every imported recipe remembers WHERE it came from as a single source URL
 * with two well-defined shapes, so update checks work the same for every
 * recipe whatever its origin:
 *
 *   direct:  https://raw.githubusercontent.com/…/recipe-x.json
 *            a plain https URL to a .json file (imported by URL, or seeded
 *            from the recipe's own `update_url` field).
 *
 *   git:     https://github.com/owner/repo#main:steamcmd/x/recipe-x.json
 *            "<canonical repo URL>#<branch>:<path>" — one recipe file of a
 *            registry repository. The fragment form is the panel's own
 *            identifier: it resolves through the registry's cached catalog
 *            when one matches, or a depth-1 clone otherwise.
 *
 * A recipe without a source (`sourceUrl` null) is hand-made: no update
 * checks, the editor is the only source of truth.
 */

// ─── Canonical git URLs ──────────────────────────────────────────────────────

/**
 * Canonical form of a git repository URL — https OR ssh:
 *
 *   https://host/path.git               → https://host/path
 *   ssh://git@host:port/path.git        → ssh://git@host:port/path
 *   git@host:path.git (SCP shorthand)   → ssh://git@host/path
 *
 * Lowercase host, no trailing ".git", no trailing slash. Both the registry
 * row and the recipe source URLs store this form, so string equality matches
 * a recipe to its registry. https and ssh forms of the SAME repository stay
 * distinct canonical URLs (each registry clones and matches by its own).
 *
 * Throws on anything else — plain http, other schemes and unparseable URLs
 * are refused (https registries are public by nature; ssh registries
 * authenticate with the panel host's git/ssh configuration).
 */
export function canonicalGitUrl(url: string): string {
  // SCP shorthand (git@host:path) normalizes to the ssh:// form first —
  // it is not a URL, so it must be rewritten before parsing.
  const scp = url.match(/^([^@/:]+@[^/:]+):(.+)$/);

  let parsed: URL;
  try {
    parsed = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : url);
  } catch {
    throw new Error('URL de dépôt invalide');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') {
    throw new Error('URL de dépôt invalide : https ou ssh requis');
  }
  if (parsed.password) {
    throw new Error('URL de dépôt invalide : mot de passe intégré refusé');
  }

  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path.endsWith('.git')) path = path.slice(0, -'.git'.length);

  const user = parsed.username ? `${parsed.username}@` : '';
  return `${parsed.protocol}//${user}${parsed.host.toLowerCase()}${path}`;
}

// ─── Source URL forms ─────────────────────────────────────────────────────────

/** A plain https URL pointing at a .json recipe file. */
export interface DirectRecipeSource {
  kind: 'direct';
  url: string;
}

/** One recipe file of a git repository (usually a registry). */
export interface GitRecipeSource {
  kind: 'git';
  repoUrl: string;
  branch: string;
  path: string;
}

export type RecipeSource = DirectRecipeSource | GitRecipeSource;

/** Git-form source URL: "<canonical repo URL>#<branch>:<path>". */
export function formatGitSource(repoUrl: string, branch: string, path: string): string {
  return `${repoUrl}#${branch}:${path}`;
}

/**
 * Parses a stored source URL into its discriminated form. Returns null for a
 * malformed fragment (a '#' without a "<branch>:<path>" after it) — callers
 * treat that as "no usable source".
 */
export function parseRecipeSource(sourceUrl: string): RecipeSource | null {
  const hashIndex = sourceUrl.indexOf('#');
  if (hashIndex === -1) return { kind: 'direct', url: sourceUrl };

  const repoUrl = sourceUrl.slice(0, hashIndex);
  const fragment = sourceUrl.slice(hashIndex + 1);
  const colonIndex = fragment.indexOf(':');
  if (colonIndex === -1) return null;

  const branch = fragment.slice(0, colonIndex);
  const path = fragment.slice(colonIndex + 1);
  if (!repoUrl || !branch || !path) return null;

  return { kind: 'git', repoUrl, branch, path };
}

// ─── Recipe update status ─────────────────────────────────────────────────────

/**
 * Lifecycle of a recipe relative to its source, in badge priority order —
 * `modified_locally` outranks `update_available` because applying the update
 * would OVERWRITE the local changes.
 */
export type RecipeSourceStatus =
  | 'local'
  | 'unchecked'
  | 'upstream_gone'
  | 'modified_locally'
  | 'update_available'
  | 'up_to_date';

/** The source columns of a recipe row, as the status computation needs them. */
export interface RecipeSourceState {
  sourceUrl: string | null;
  /**
   * Canonical hash of the recipe as imported/updated from the source
   * (null = unknown, e.g. a legacy row seeded before stamping existed).
   */
  sourceSha: string | null;
  /**
   * Canonical hash of the upstream content at the last successful check —
   * null WITH a checkedAt means the check ran and found nothing usable
   * (file gone upstream, or the registry was deleted).
   */
  remoteSha: string | null;
  /** When the upstream was last checked — null = never. */
  remoteCheckedAt: Date | null;
  /** Canonical hash of the CURRENTLY STORED json — detects local edits. */
  storedSha: string | null;
}

/** Derives the single status of a recipe row from its source columns. */
export function computeRecipeStatus(state: RecipeSourceState): RecipeSourceStatus {
  if (!state.sourceUrl) return 'local';
  if (!state.remoteCheckedAt) return 'unchecked';
  if (!state.remoteSha) return 'upstream_gone';

  // Local edits since the last import: the stored content no longer matches
  // what the source delivered (only detectable when the import stamp exists).
  if (state.sourceSha && state.storedSha && state.storedSha !== state.sourceSha) {
    return 'modified_locally';
  }

  // Baseline of the comparison: the import stamp, or — for legacy rows
  // without one — the currently stored content.
  const baseline = state.sourceSha ?? state.storedSha;
  if (baseline && baseline !== state.remoteSha) return 'update_available';
  return 'up_to_date';
}

// ─── Registry catalog entries ─────────────────────────────────────────────────

/**
 * The catalog entries of a registry used to be cached as a JSONB array on
 * the registry row; they now live in their own `registry_entry` table
 * (`RegistryEntry` in ~/db/entities) and the sync replaces the row set.
 * The statuses below stay pure: they compare ONE upstream entry against
 * the locally installed copy of the recipe.
 */
export type RegistryEntryStatus =
  | 'not_imported'
  | 'up_to_date'
  | 'update_available'
  | 'modified_locally'
  | 'invalid'
  | 'upstream_gone';

/**
 * One catalog card of the marketplace page — the wire shape returned by
 * `listRegistryEntriesFn`: the registry entry matched against the recipes
 * table (cover included, `content` EXCLUDED — fetched on demand by
 * `getRegistryEntryFn` for the "view JSON" dialog / the import).
 */
export interface RegistryCatalogEntry {
  /** POSIX path inside the repository. */
  path: string;
  name: string | null;
  slug: string | null;
  /** 'runtime' or null (app recipe). */
  type: string | null;
  description: string | null;
  /** Why the file does not validate — the entry is listed, not importable. */
  error: string | null;
  /** Vertical cover artwork (base64 data URL) — null = generated gradient. */
  cover: string | null;
  status: RegistryEntryStatus;
  recipeId: string | null;
  recipeName: string | null;
}

/** What the catalog row knows about the locally installed copy (null = none). */
export interface RegistryEntryRecipeRef {
  recipeId: string;
  slug: string;
  name: string;
  sourceSha: string | null;
  storedSha: string | null;
}

/**
 * Derives the status of a catalog entry: an invalid file is never
 * importable, a local copy that drifted from its import stamp is modified,
 * and differing hashes mean an update is available upstream.
 */
export function computeEntryStatus(
  entry: { error: string | null; sha: string },
  recipe: RegistryEntryRecipeRef | null,
): RegistryEntryStatus {
  if (entry.error) return 'invalid';
  if (!recipe) return 'not_imported';
  if (recipe.sourceSha && recipe.storedSha && recipe.storedSha !== recipe.sourceSha) {
    return 'modified_locally';
  }
  const baseline = recipe.sourceSha ?? recipe.storedSha;
  if (baseline && baseline !== entry.sha) return 'update_available';
  return 'up_to_date';
}

/**
 * Whether a catalog entry and an imported recipe are THE SAME recipe. The
 * identity is the registry + the recipe id (the slug) — NOT the file path:
 * a file renamed upstream is still the same recipe, and the sync re-points
 * the recipe's source URL to its new path. Only an entry that does not
 * validate (no id to match) falls back to the exact path it sits at.
 */
export function isSameRegistryRecipe(
  registry: { url: string; branchName: string },
  entry: { path: string; slug?: string | null },
  recipe: { slug: string; sourceUrl: string },
): boolean {
  if (!registry.branchName) return false;
  if (!recipe.sourceUrl.startsWith(`${registry.url}#${registry.branchName}:`)) return false;
  if (entry.slug) return entry.slug === recipe.slug;
  return recipe.sourceUrl === formatGitSource(registry.url, registry.branchName, entry.path);
}

// ─── Error formatting ─────────────────────────────────────────────────────────

/** Readable error message (ZodError → list of fields in error). */
export function recipeErrorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join('.') || 'recipe'} : ${i.message}`).join(' · ');
  }
  return (err as Error).message;
}
