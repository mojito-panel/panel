import { createServerFn } from '@tanstack/react-start';

import { Recipe, Registry, RegistryEntry, SshKey } from '~/db/entities';
import {
  computeEntryStatus,
  isSameRegistryRecipe,
  type RegistryCatalogEntry,
  type RegistryEntryRecipeRef,
  type RegistryEntryStatus,
} from '~/lib/recipe-source';
import {
  addRegistrySchema,
  importRegistryEntrySchema,
  registryIdSchema,
  updateRecipeSourceSchema,
  updateRegistrySchema,
} from '~/validators/marketplace';

import { logActivity } from '../activity';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import {
  addRegistry,
  deleteRegistry,
  enqueueRegistrySync,
  getRegistryEntry,
  importRegistryEntry,
  updateRecipeFromSource,
  updateRegistry,
} from '../registries';
import { canonicalRecipeHash } from '../registry-entries';
import { HttpError, requirePanelPermission } from '../session';

/**
 * Marketplace server functions — registries (admin marketplace page) and
 * the unified recipe source updates. Thin: permission + validator + request
 * context, then service calls (../registries, ../recipes).
 */

/**
 * One registry card of the marketplace grid (what listRegistriesFn returns)
 * — the registry, its cover and its catalog status counts. The private key
 * NEVER travels: only its display name (badge) and the detached id.
 */
export interface RegistryCardRow {
  id: string;
  name: string;
  url: string;
  /** Tracked branch — '' = the repository's default. */
  branch: string;
  /** Branch name resolved by the last sync (feeds the recipe source URLs). */
  branchName: string;
  /** Repo-root cover (base64 data URL) — null = generated gradient. */
  cover: string | null;
  /** registry.json manifest metadata, stamped at every sync. */
  description: string | null;
  author: string | null;
  license: string | null;
  /** True until the first sync lands — the page polls meanwhile. */
  neverSynced: boolean;
  lastSyncedAt: Date | null;
  lastError: string | null;
  entryCount: number;
  /** Catalog status counts, matched against the recipes table. */
  notImported: number;
  upToDate: number;
  updateAvailable: number;
  modifiedLocally: number;
  invalid: number;
  upstreamGone: number;
  /** SSH key of a PRIVATE repository — the clone authenticates with it. */
  sshKeyId: string | null;
  sshKeyName: string | null;
}

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

/**
 * Finds the recipe imported from one catalog entry — the identity is the
 * registry + the recipe id (`isSameRegistryRecipe`), NOT the path: a file
 * renamed upstream stays matched to its local copy instead of orphaning it.
 */
function findEntryRecipe(
  recipes: RecipeSourceRow[],
  registry: { url: string; branchName: string },
  entry: { path: string; slug?: string | null },
): RecipeSourceRow | null {
  return recipes.find((recipe) => isSameRegistryRecipe(registry, entry, recipe)) ?? null;
}

/** Light columns of a catalog entry — all the status counts need. */
interface RegistryEntryLight {
  registryId: string;
  path: string;
  slug: string | null;
  sha: string;
  error: string | null;
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

/**
 * Full registry set with their catalog status counts, for the CARD GRID of
 * the marketplace page (covers included — a registry card renders its
 * repo-root cover or a generated gradient). The entry counts are computed
 * from LIGHT columns only (registryId/path/sha/error — never the cached
 * file contents), so the page stays cheap however big the catalogs grow.
 */
export const listRegistriesFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async (): Promise<{ registries: RegistryCardRow[] }> => {
    await requirePanelPermission({ 'panel.recipes': ['read'] });

    const em = orm.em;
    const registries = await em.find(Registry, {});
    const recipes = await loadRecipeSourceRows();

    const registryIds = registries.map((registry) => registry.id);
    const entryRows = registryIds.length
      ? await em.find(
          RegistryEntry,
          { registryId: { $in: registryIds } },
          // Light columns only — the cached file contents (and covers) stay
          // out of the registry list however big the catalogs grow.
          { fields: ['registryId', 'path', 'slug', 'sha', 'error'] },
        )
      : [];
    const entries: RegistryEntryLight[] = entryRows.map((entry) => ({
      registryId: entry.registryId,
      path: entry.path,
      slug: entry.slug ?? null,
      sha: entry.sha,
      error: entry.error ?? null,
    }));

    // Attached SSH keys (private repositories) — names for the card badges.
    const keyIds = [
      ...new Set(
        registries.map((registry) => registry.sshKeyId).filter((id): id is string => id !== null),
      ),
    ];
    const keys = keyIds.length > 0 ? await em.find(SshKey, { id: { $in: keyIds } }) : [];
    const keyNames = new Map(keys.map((key) => [key.id, key.name]));

    const entriesByRegistry = new Map<string, RegistryEntryLight[]>();
    for (const entry of entries) {
      const group = entriesByRegistry.get(entry.registryId);
      if (group) group.push(entry);
      else entriesByRegistry.set(entry.registryId, [entry]);
    }

    const rows = registries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((registry): RegistryCardRow => {
        const entries = entriesByRegistry.get(registry.id) ?? [];
        let notImported = 0;
        let upToDate = 0;
        let updateAvailable = 0;
        let modifiedLocally = 0;
        let invalid = 0;

        for (const entry of entries) {
          const recipe = findEntryRecipe(recipes, registry, entry);
          const { status } = toStatusInput(entry, recipe);
          if (status === 'not_imported') notImported++;
          else if (status === 'up_to_date') upToDate++;
          else if (status === 'update_available') updateAvailable++;
          else if (status === 'modified_locally') modifiedLocally++;
          else invalid++;
        }

        // Recipes imported from this registry whose file disappeared upstream
        // (no catalog entry matches them anymore — by id, or by path for an
        // id-less file).
        const upstreamGone = registry.branchName
          ? recipes.filter(
              (recipe) =>
                recipe.sourceUrl.startsWith(`${registry.url}#${registry.branchName}:`) &&
                !entries.some((entry) => isSameRegistryRecipe(registry, entry, recipe)),
            ).length
          : 0;

        return {
          id: registry.id,
          name: registry.name,
          url: registry.url,
          branch: registry.branch,
          branchName: registry.branchName,
          cover: registry.cover ?? null,
          description: registry.description ?? null,
          author: registry.author ?? null,
          license: registry.license ?? null,
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
          sshKeyId: registry.sshKeyId ?? null,
          sshKeyName: registry.sshKeyId ? (keyNames.get(registry.sshKeyId) ?? null) : null,
        };
      });

    return { registries: rows };
  });

/** Adds a registry and enqueues its first sync (the page polls the result). */
export const addRegistryFn = createServerFn({ method: 'POST' })
  .validator(addRegistrySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.recipes': ['create'] });
    const registry = await addRegistry(data);
    await logActivity({
      event: 'registry:add',
      description: `Registre « ${registry.name} » ajouté (${registry.url})`,
      actor: { id: user.id, name: user.name, email: user.email },
      properties: { registryId: registry.id },
    });
    return { id: registry.id };
  });

/**
 * Edits a registry (name / branch / SSH key) — a branch or key change
 * re-enqueues a sync (the service decides), the UI polls the result.
 */
export const updateRegistryFn = createServerFn({ method: 'POST' })
  .validator(updateRegistrySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.recipes': ['update'] });
    const result = await updateRegistry(data);
    await logActivity({
      event: 'registry:update',
      description: `Registre « ${data.name} » modifié`,
      actor: { id: user.id, name: user.name, email: user.email },
      properties: { registryId: data.registryId, resynced: result.synced },
    });
    return result;
  });

/** Enqueues a manual sync of one registry (pg-boss job — the UI polls). */
export const syncRegistryFn = createServerFn({ method: 'POST' })
  .validator(registryIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.recipes': ['update'] });
    await enqueueRegistrySync(data.registryId);
    await logActivity({
      event: 'registry:sync',
      description: `Synchronisation du registre demandée (${data.registryId})`,
      actor: { id: user.id, name: user.name, email: user.email },
      properties: { registryId: data.registryId },
    });
    return { queued: true };
  });

export const deleteRegistryFn = createServerFn({ method: 'POST' })
  .validator(registryIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.recipes': ['delete'] });
    const registry = await orm.em.findOne(Registry, { id: data.registryId });
    await deleteRegistry(data.registryId);
    await logActivity({
      event: 'registry:delete',
      description: `Registre « ${registry?.name ?? data.registryId} » supprimé`,
      actor: { id: user.id, name: user.name, email: user.email },
      properties: { registryId: data.registryId },
    });
    return { deleted: true };
  });

// ─── Catalog (/admin/marketplace/$registryId) ────────────────────────────────

/**
 * One registry's catalog: its `registry_entry` rows (WITHOUT the cached
 * file contents — heavy and useless to a card grid) matched against the
 * recipes table. Runtimes sort first, then name A-Z.
 */
export const listRegistryEntriesFn = createServerFn({ method: 'POST' })
  .validator(registryIdSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.recipes': ['read'] });

    const registry = await orm.em.findOne(Registry, { id: data.registryId });
    if (!registry) throw new HttpError(404, 'Registre introuvable');

    const recipes = await loadRecipeSourceRows();
    // Light columns only — the cached file CONTENT stays out of the grid
    // (the "view JSON" dialog fetches one entry on demand).
    const entries = await orm.em.find(
      RegistryEntry,
      { registryId: data.registryId },
      { exclude: ['content'] },
    );

    const rows: RegistryCatalogEntry[] = entries.map((entry): RegistryCatalogEntry => {
      const recipe = findEntryRecipe(recipes, registry, entry);
      const { status } = toStatusInput({ error: entry.error ?? null, sha: entry.sha }, recipe);
      return {
        path: entry.path,
        name: entry.name ?? null,
        slug: entry.slug ?? null,
        type: entry.type ?? null,
        description: entry.description ?? null,
        error: entry.error ?? null,
        cover: entry.cover ?? null,
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
        if (entries.some((entry) => isSameRegistryRecipe(registry, entry, recipe))) continue;
        const path = recipe.sourceUrl.slice(prefix.length);
        rows.push({
          path,
          name: recipe.name,
          slug: recipe.slug,
          type: null,
          description: null,
          error: null,
          cover: null,
          status: 'upstream_gone',
          recipeId: recipe.id,
          recipeName: recipe.name,
        });
      }
    }

    // Runtimes first (they are required by other recipes), then name A-Z
    // (falling back to the slug, then the path for the nameless ones).
    rows.sort((a, b) => {
      const runtimeRank = Number(b.type === 'runtime') - Number(a.type === 'runtime');
      if (runtimeRank !== 0) return runtimeRank;
      const aName = a.name ?? a.slug ?? a.path;
      const bName = b.name ?? b.slug ?? b.path;
      return aName.localeCompare(bName);
    });

    return {
      registry: {
        id: registry.id,
        name: registry.name,
        url: registry.url,
        branch: registry.branch,
        branchName: registry.branchName,
        cover: registry.cover ?? null,
        description: registry.description ?? null,
        author: registry.author ?? null,
        license: registry.license ?? null,
        neverSynced: registry.lastSyncedAt === null || registry.lastSyncedAt === undefined,
        lastSyncedAt: registry.lastSyncedAt ?? null,
        lastError: registry.lastError ?? null,
      },
      entries: rows,
    };
  });

/** Raw file content of ONE catalog entry — the "view JSON" dialog reads it. */
export const getRegistryEntryFn = createServerFn({ method: 'POST' })
  .validator(importRegistryEntrySchema) // { registryId, path } — same shape
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.recipes': ['read'] });
    // The service owns the lookup (single findOne, 404 semantics).
    return getRegistryEntry(data.registryId, data.path);
  });

/** Imports (or updates) one catalog entry in one click — with its runtimes. */
export const importRegistryEntryFn = createServerFn({ method: 'POST' })
  .validator(importRegistryEntrySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.recipes': ['create'] });
    const report = await importRegistryEntry(data.registryId, data.path);
    await logActivity({
      event: 'registry:import',
      description: `Recette « ${report.slug} » importée du registre`,
      actor: { id: user.id, name: user.name, email: user.email },
      properties: {
        registryId: data.registryId,
        path: data.path,
        created: report.created,
        imported: report.imported.map((d) => d.slug),
        missing: report.missing,
      },
    });
    return report;
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
    const user = await requirePanelPermission({ 'panel.recipes': ['update'] });
    const result = await updateRecipeFromSource(data.recipeId);
    await logActivity({
      event: 'recipe:update_source',
      description: `Recette « ${result.slug} » mise à jour depuis sa source`,
      actor: { id: user.id, name: user.name, email: user.email },
      properties: { recipeId: data.recipeId },
    });
    return result;
  });
