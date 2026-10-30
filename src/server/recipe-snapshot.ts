import '@tanstack/react-start/server-only';
import type { Recipe as RecipeContract, RecipeVariable } from '~/contract';
import { Recipe } from '~/db/entities';
import type { IServer } from '~/db/types';
import { mergeVariableDefinitions } from '~/lib/recipe-merge';
import { normalizeStoredRecipe } from '~/lib/stored-recipe';

import { orm } from './orm';
import { canonicalRecipeHash } from './registry-entries';
import { resolveRuntimeRecipes } from './runtimes';

/**
 * Per-server recipe snapshot (self-contained server side).
 *
 * A server stores the recipe it was installed with — the app recipe with
 * the required runtimes' variable definitions MERGED into `variables`, plus
 * the resolved runtime recipes — and every agent call sends that snapshot
 * directly. A recipe edited later never impacts an existing server; the
 * explicit "reload recipe" action is the only propagation path.
 */

/** The snapshot stored on the server row — ONE self-contained document. */
export interface ServerRecipeSnapshot {
  /** App recipe with merged variable definitions (normalized, v4). */
  recipe: RecipeContract;
  /** Resolved runtime recipes of the requires graph (normalized, v4). */
  runtimes: Record<string, unknown>[];
  /**
   * Content hash of the whole graph as snapshotted — the app recipe plus
   * every runtime, `{ id, sha }` per recipe (canonical JSON hash, the same
   * identity the marketplace uses). The "recipe updated since the
   * snapshot" check compares it against the CURRENT graph (`recipeGraphHash`)
   * instead of dates: `updated_at` moves on every write (a sync stamping
   * the upstream hash is not an edit), the hash moves only on a real
   * content change. Null on a legacy snapshot taken before it existed.
   */
  sha?: string | null;
}

/**
 * Builds a fresh snapshot from a recipe JSON: normalized app recipe with
 * the merged variable definitions, plus the resolved runtime recipes.
 */
export async function buildRecipeSnapshot(
  recipeJson: Record<string, unknown> | null | undefined,
): Promise<ServerRecipeSnapshot> {
  // DEEP CLONE on the entity boundary: the recipe JSONs are LIVE
  // MikroORM entity objects (a v4 recipe passes through normalization
  // untouched) — storing references on the server row means any later
  // in-place edit of the snapshot would silently write through into
  // the recipe row. The snapshot owns a fully detached copy.
  const app = structuredClone(
    normalizeStoredRecipe((recipeJson ?? {}) as Record<string, unknown>),
  ) as RecipeContract;
  const runtimes = (await resolveRuntimeRecipes(recipeJson)).map((runtime) =>
    structuredClone(runtime),
  ) as Record<string, unknown>[];

  // The runtime recipes are normalized (v4) but still carry their own
  // variable declarations — the merge needs them before they leave.
  const runtimeVariables: RecipeVariable[][] = runtimes.map(
    (runtime) => (runtime.variables as RecipeVariable[] | undefined) ?? [],
  );
  const recipe = {
    ...app,
    variables: mergeVariableDefinitions(app.variables ?? [], runtimeVariables),
  };
  return { recipe, runtimes, sha: recipeGraphHashOf(recipe, runtimes) };
}

/**
 * Slugs of the app recipe's runtime graph (transitive, deduplicated) —
 * the same walk as resolveRuntimeRecipes, without the payloads.
 */
async function runtimeSlugs(
  recipeJson: Record<string, unknown> | null | undefined,
): Promise<string[]> {
  const em = orm.em;
  const seen = new Set<string>();
  // COPY, never alias: for a v4 recipe `recipeJson` IS the live entity's
  // json object — the walk shifts its queue dry, aliasing `requires`
  // would empty the array on the managed entity and the next flush
  // would persist the emptied graph to the recipe row.
  const queue: string[] = Array.isArray(recipeJson?.requires)
    ? [...(recipeJson.requires as string[])]
    : [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = await em.findOne(Recipe, { slug: id });
    const json = row?.json as Record<string, unknown> | undefined;
    if (row && Array.isArray(json?.requires)) {
      queue.push(...(json.requires as string[]));
    }
  }
  return [...seen];
}

/**
 * The latest edit of the recipe GRAPH — the app recipe row and every
 * resolved runtime row. Informational (the recipes list shows it): it is
 * NOT the "server is outdated" signal, which compares content hashes
 * (`isRecipeSnapshotOutdated`) — `updated_at` moves on every write, a
 * marketplace sync included.
 */
export async function recipeGraphUpdatedAt(
  recipeJson: Record<string, unknown> | null | undefined,
  appUpdatedAt: Date,
): Promise<Date> {
  const em = orm.em;
  const slugs = await runtimeSlugs(recipeJson);
  if (slugs.length === 0) return appUpdatedAt;
  const rows = await em.find(Recipe, { slug: { $in: slugs } });
  let latest = appUpdatedAt;
  for (const row of rows) {
    if (row.updatedAt > latest) latest = row.updatedAt;
  }
  return latest;
}

/**
 * The CURRENT content hash of a recipe graph — the app recipe row plus
 * every resolved runtime row, in the exact shape `buildRecipeSnapshot`
 * would snapshot them (normalized, runtime variable definitions merged into
 * the app recipe). Compared against the snapshot's stored `sha`: equal
 * means the server runs the current version, whatever `updated_at` says.
 *
 * `updated_at` is a plain automatic column (it moves on every write — a
 * sync stamping the upstream hash, a no-op re-import), so it is NOT the
 * change signal; the content hash is.
 */
export async function recipeGraphHash(
  recipeJson: Record<string, unknown> | null | undefined,
): Promise<string> {
  const em = orm.em;
  const slugs = await runtimeSlugs(recipeJson);
  const rows = slugs.length > 0 ? await em.find(Recipe, { slug: { $in: slugs } }) : [];

  const app = normalizeStoredRecipe(
    (recipeJson ?? {}) as Record<string, unknown>,
  ) as RecipeContract;
  const runtimes = rows.map((row) => normalizeStoredRecipe(row.json as Record<string, unknown>));
  const recipe = {
    ...app,
    variables: mergeVariableDefinitions(
      app.variables ?? [],
      runtimes.map((runtime) => (runtime.variables as RecipeVariable[] | undefined) ?? []),
    ),
  };
  return recipeGraphHashOf(recipe, runtimes);
}

/** The graph hash of an already-built snapshot (see `recipeGraphHash`). */
export function recipeGraphHashOf(appRecipe: unknown, runtimes: unknown[]): string {
  const entries = [appRecipe, ...runtimes].map((recipe) => ({
    id: (recipe as { id?: unknown } | null)?.id ?? null,
    sha: canonicalRecipeHash(recipe),
  }));
  entries.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return canonicalRecipeHash(entries);
}

/**
 * Whether the server's snapshot is BEHIND the current recipe graph — the
 * signal of the reload-recipe button and the sidebar dot.
 *
 * - the snapshot stores its graph hash (`sha`): a pure content comparison —
 *   a marketplace sync or a no-op re-import that only moved `updated_at`
 *   never flags the server;
 * - a legacy snapshot without one: the date comparison (best effort until
 *   the next reload stamps the hash).
 */
export async function isRecipeSnapshotOutdated(
  server: IServer,
  recipeJson: Record<string, unknown> | null | undefined,
  appUpdatedAt: Date,
): Promise<boolean> {
  const stored = server.recipeSnapshot as unknown;
  const snapshot = isServerRecipeSnapshot(stored) ? stored : null;

  if (snapshot?.sha) {
    return snapshot.sha !== (await recipeGraphHash(recipeJson));
  }

  const em = orm.em;
  const slugs = await runtimeSlugs(recipeJson);
  const rows = slugs.length > 0 ? await em.find(Recipe, { slug: { $in: slugs } }) : [];
  let latest = appUpdatedAt;
  for (const row of rows) {
    if (row.updatedAt > latest) latest = row.updatedAt;
  }
  return !!server.recipeSyncedAt && latest > server.recipeSyncedAt;
}

/**
 * Whether the server's stored snapshot document is usable. The check is
 * deep on purpose: a legacy row (or a half-written document) must be
 * re-snapshotted, not served — the snapshot is what the agent installs
 * with, so a malformed one has to fail closed.
 */
export function isServerRecipeSnapshot(stored: unknown): stored is ServerRecipeSnapshot {
  if (!stored || typeof stored !== 'object') return false;
  const document = stored as { recipe?: unknown; runtimes?: unknown };
  if (!document.recipe || typeof document.recipe !== 'object') return false;
  if (!Array.isArray(document.runtimes)) return false;
  // The app recipe is identified by its id — a document without one is a
  // folded legacy row, not a snapshot.
  return typeof (document.recipe as { id?: unknown }).id === 'string';
}

/**
 * The snapshot of a server — the stored one when it exists, a fresh build
 * from the current recipe row otherwise (legacy pre-snapshot servers are
 * backfilled on first touch, dated now: the recipe they run is the one
 * the panel has).
 */
export async function serverRecipeSnapshot(server: IServer): Promise<ServerRecipeSnapshot> {
  const em = orm.em;
  const stored = server.recipeSnapshot as unknown;
  if (isServerRecipeSnapshot(stored)) {
    return stored;
  }
  const recipe = await em.findOne(Recipe, { id: server.recipeId });
  if (!recipe) {
    // No stored snapshot and no recipe row: the panel DB itself is broken.
    throw new Error('Recette introuvable');
  }
  const snapshot = await buildRecipeSnapshot(recipe.json as Record<string, unknown>);
  server.recipeSnapshot = snapshot as unknown as Record<string, unknown>;
  server.recipeSyncedAt = new Date();
  await em.flush();
  return snapshot;
}
