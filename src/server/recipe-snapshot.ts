import '@tanstack/react-start/server-only';
import type { EntityManager } from '@mikro-orm/core';
import type { Recipe as RecipeContract, RecipeVariable } from '~/contract';
import { Recipe } from '~/db/entities';
import type { IServer } from '~/db/types';
import { normalizeStoredRecipe } from '~/lib/stored-recipe';
import { mergeVariableDefinitions } from '~/lib/recipe-merge';
import { resolveRuntimeRecipes } from './functions/runtimes';

/**
 * Per-server recipe snapshot (self-contained server side).
 *
 * A server stores the recipe it was installed with — the app recipe with
 * the required runtimes' variable definitions MERGED into `variables`, plus
 * the resolved runtime recipes — and every agent call sends that snapshot
 * directly. A recipe edited later never impacts an existing server; the
 * explicit "reload recipe" action is the only propagation path.
 */

/** The snapshot stored on the server row (both JSON columns, one concept). */
export interface ServerRecipeSnapshot {
  /** App recipe with merged variable definitions (normalized, v4). */
  recipe: RecipeContract;
  /** Resolved runtime recipes of the requires graph (normalized, v4). */
  runtimes: Record<string, unknown>[];
}

/**
 * Builds a fresh snapshot from a recipe JSON: normalized app recipe with
 * the merged variable definitions, plus the resolved runtime recipes.
 */
export async function buildRecipeSnapshot(
  em: EntityManager,
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
  const runtimes = (await resolveRuntimeRecipes(em, recipeJson)).map(
    (runtime) => structuredClone(runtime),
  ) as Record<string, unknown>[];

  // The runtime recipes are normalized (v4) but still carry their own
  // variable declarations — the merge needs them before they leave.
  const runtimeVariables: RecipeVariable[][] = runtimes.map(
    (runtime) => ((runtime.variables as RecipeVariable[] | undefined) ?? []),
  );
  const recipe = {
    ...app,
    variables: mergeVariableDefinitions(app.variables ?? [], runtimeVariables),
  };
  return { recipe, runtimes };
}

/**
 * Slugs of the app recipe's runtime graph (transitive, deduplicated) —
 * the same walk as resolveRuntimeRecipes, without the payloads.
 */
async function runtimeSlugs(
  em: EntityManager,
  recipeJson: Record<string, unknown> | null | undefined,
): Promise<string[]> {
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
 * resolved runtime row. The reload-recipe button compares this against
 * the server's snapshot date: editing the java RUNTIME matters as much
 * as editing the app recipe itself.
 */
export async function recipeGraphUpdatedAt(
  em: EntityManager,
  recipeJson: Record<string, unknown> | null | undefined,
  appUpdatedAt: Date,
): Promise<Date> {
  const slugs = await runtimeSlugs(em, recipeJson);
  if (slugs.length === 0) return appUpdatedAt;
  const rows = await em.find(Recipe, { slug: { $in: slugs } });
  let latest = appUpdatedAt;
  for (const row of rows) {
    if (row.updatedAt > latest) latest = row.updatedAt;
  }
  return latest;
}

/**
 * The snapshot of a server — the stored one when it exists, a fresh build
 * from the current recipe row otherwise (legacy pre-snapshot servers are
 * backfilled on first touch, dated now: the recipe they run is the one
 * the panel has).
 */
export async function serverRecipeSnapshot(
  em: EntityManager,
  server: IServer,
): Promise<ServerRecipeSnapshot> {
  if (server.recipeSnapshot && server.runtimeSnapshots) {
    return {
      recipe: server.recipeSnapshot as unknown as RecipeContract,
      runtimes: server.runtimeSnapshots,
    };
  }
  const recipe = await em.findOne(Recipe, { id: server.recipeId });
  if (!recipe) {
    // No stored snapshot and no recipe row: the panel DB itself is broken.
    throw new Error('Recette introuvable');
  }
  const snapshot = await buildRecipeSnapshot(em, recipe.json as Record<string, unknown>);
  server.recipeSnapshot = snapshot.recipe as unknown as Record<string, unknown>;
  server.runtimeSnapshots = snapshot.runtimes;
  server.recipeSyncedAt = new Date();
  await em.flush();
  return snapshot;
}
