import { createServerFn } from '@tanstack/react-start';
import { Recipe, RecipeRegistry } from '~/db/entities';
import { orm } from '../orm';
import { HttpError, requirePanelPermission } from '../session';
import { withOrmContext } from '../middleware';
import { canonicalRecipeHash } from '../registry-entries';
import {
  computeEntryStatus,
  formatGitSource,
  type RegistryCatalogEntry,
  type RegistryEntryRecipeRef,
  type RegistryEntryStatus,
} from '~/lib/recipe-source';
import {
  addRegistry,
  deleteRegistry,
  enqueueRegistrySync,
  importRegistryEntry,
  updateRecipeFromSource,
} from '../registries';
import { adminRegistriesList, type AdminRegistryRow } from '~/lists/registries';
import {
  addRegistrySchema,
  importRegistryEntrySchema,
  registryIdSchema,
  updateRecipeSourceSchema,
} from '~/validators/marketplace';

/**
 * Marketplace server functions — registries (admin marketplace page) and
 * the unified recipe source updates. Thin: permission + validator + request
 * context, then service calls (../registries, ../recipes).
 */

/** Source columns of a recipe, as the catalog status computation needs them. */
interface RecipeSourceRow {
  id: string;
  slug: string;
  name: string;
  sourceUrl: string;
  sourceSha: string | null;
  storedSha: string;
}

/** Loads every sourced recipe once — both list functions match against it. */
async function loadRecipeSourceRows(): Promise<RecipeSourceRow[]> {
  const recipes = await orm.em.find(Recipe, { sourceUrl: { $ne: null } });
  return recipes.map((recipe) => ({
    id: recipe.id,
    slug: recipe.slug,
    name: recipe.name,
    sourceUrl: recipe.sourceUrl as string,
    sourceSha: recipe.sourceSha ?? null,
    storedSha: canonicalRecipeHash(recipe.json),
  }));
}

/** Finds the recipe imported from one catalog entry (by its source URL). */
function findEntryRecipe(
  recipes: RecipeSourceRow[],
  registry: { url: string; branchName: string },
  path: string,
): RecipeSourceRow | null {
  const sourceUrl = formatGitSource(registry.url, registry.branchName, path);
  return recipes.find((recipe) => recipe.sourceUrl === sourceUrl) ?? null;
}

/** Catalog entry + its local recipe, in the shape `computeEntryStatus` takes. */
function toStatusInput(
  entry: { error: string | null; sha: string },
  recipe: RecipeSourceRow | null,
): { status: RegistryEntryStatus; ref: RegistryEntryRecipeRef | null } {
  const ref = recipe
    ? {
        recipeId: recipe.id,
        slug: recipe.slug,
        name: recipe.name,
        sourceSha: recipe.sourceSha,
        storedSha: recipe.storedSha,
      }
    : null;
  return { status: computeEntryStatus(entry, ref), ref };
}

// ─── Registries (/admin/marketplace) ─────────────────────────────────────────

/** Full registry set with their catalog status counts (small, unpaginated). */
export const listRegistriesFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async (): Promise<{ registries: AdminRegistryRow[] }> => {
    await requirePanelPermission({ 'panel.recipes': ['read'] });

    const registries = await orm.em.find(RecipeRegistry, {});
    const recipes = await loadRecipeSourceRows();

    const rows = registries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((registry): AdminRegistryRow => {
        const entries = registry.entries ?? [];
        let notImported = 0;
        let upToDate = 0;
        let updateAvailable = 0;
        let modifiedLocally = 0;
        let invalid = 0;

        for (const entry of entries) {
          const recipe = registry.branchName
            ? findEntryRecipe(recipes, registry, entry.path)
            : null;
          const { status } = toStatusInput(entry, recipe);
          if (status === 'not_imported') notImported++;
          else if (status === 'up_to_date') upToDate++;
          else if (status === 'update_available') updateAvailable++;
          else if (status === 'modified_locally') modifiedLocally++;
          else invalid++;
        }

        // Recipes imported from this registry whose file disappeared upstream.
        const upstreamGone = registry.branchName
          ? recipes.filter(
              (recipe) =>
                recipe.sourceUrl.startsWith(`${registry.url}#${registry.branchName}:`) &&
                !entries.some(
                  (entry) =>
                    recipe.sourceUrl ===
                    formatGitSource(registry.url, registry.branchName, entry.path),
                ),
            ).length
          : 0;

        return {
          id: registry.id,
          name: registry.name,
          url: registry.url,
          branch: registry.branch,
          branchName: registry.branchName,
          neverSynced: registry.lastSyncedAt === null || registry.lastSyncedAt === undefined,
          lastSyncedAt: registry.lastSyncedAt ?? null,
          lastError: registry.lastError ?? null,
          entryCount: entries.length,
          notImported,
          upToDate,
          updateAvailable,
          modifiedLocally,
          invalid,
          upstreamGone,
        };
      });

    return { registries: rows };
  });

/** Adds a registry and enqueues its first sync (the page polls the result). */
export const addRegistryFn = createServerFn({ method: 'POST' })
  .validator(addRegistrySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.recipes': ['create'] });
    const registry = await addRegistry(data);
    return { id: registry.id };
  });

/** Enqueues a manual sync of one registry (pg-boss job — the UI polls). */
export const syncRegistryFn = createServerFn({ method: 'POST' })
  .validator(registryIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.recipes': ['update'] });
    await enqueueRegistrySync(data.registryId);
    return { queued: true };
  });

export const deleteRegistryFn = createServerFn({ method: 'POST' })
  .validator(registryIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.recipes': ['delete'] });
    await deleteRegistry(data.registryId);
    return { deleted: true };
  });

// ─── Catalog (/admin/marketplace/$registryId) ────────────────────────────────

/** One registry's catalog: its entries matched against the recipes table. */
export const listRegistryEntriesFn = createServerFn({ method: 'POST' })
  .validator(registryIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.recipes': ['read'] });

    const registry = await orm.em.findOne(RecipeRegistry, { id: data.registryId });
    if (!registry) throw new HttpError(404, 'Registre introuvable');

    const recipes = await loadRecipeSourceRows();
    const entries = registry.entries ?? [];
    const rows: RegistryCatalogEntry[] = entries.map((entry): RegistryCatalogEntry => {
      const recipe = registry.branchName
        ? findEntryRecipe(recipes, registry, entry.path)
        : null;
      const { status } = toStatusInput(entry, recipe);
      return {
        path: entry.path,
        name: entry.name,
        slug: entry.slug,
        type: entry.type,
        description: entry.description,
        error: entry.error,
        cover: entry.cover,
        content: entry.content,
        status,
        recipeId: recipe?.id ?? null,
        recipeName: recipe?.name ?? null,
      };
    });

    // Recipes imported from this registry whose file disappeared upstream:
    // they stay listed (greyed) so the admin sees WHY the catalog dropped them.
    if (registry.branchName) {
      const prefix = `${registry.url}#${registry.branchName}:`;
      for (const recipe of recipes) {
        if (!recipe.sourceUrl.startsWith(prefix)) continue;
        const path = recipe.sourceUrl.slice(prefix.length);
        if (entries.some((entry) => entry.path === path)) continue;
        rows.push({
          path,
          name: recipe.name,
          slug: recipe.slug,
          type: null,
          description: null,
          error: null,
          cover: null,
          content: '',
          status: 'upstream_gone',
          recipeId: recipe.id,
          recipeName: recipe.name,
        });
      }
    }

    rows.sort((a, b) => a.path.localeCompare(b.path));

    return {
      registry: {
        id: registry.id,
        name: registry.name,
        url: registry.url,
        branch: registry.branch,
        branchName: registry.branchName,
        neverSynced: registry.lastSyncedAt === null || registry.lastSyncedAt === undefined,
        lastSyncedAt: registry.lastSyncedAt ?? null,
        lastError: registry.lastError ?? null,
      },
      entries: rows,
    };
  });

/** Imports (or updates) one catalog entry in one click. */
export const importRegistryEntryFn = createServerFn({ method: 'POST' })
  .validator(importRegistryEntrySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.recipes': ['create'] });
    return importRegistryEntry(data.registryId, data.path);
  });

// ─── Source updates (/admin/recipes) ─────────────────────────────────────────

/**
 * Updates one recipe from its source (registry cache, git clone or direct
 * URL — wherever the source URL resolves, ~/lib/recipe-source).
 */
export const updateRecipeFromSourceFn = createServerFn({ method: 'POST' })
  .validator(updateRecipeSourceSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.recipes': ['update'] });
    return updateRecipeFromSource(data.recipeId);
  });
