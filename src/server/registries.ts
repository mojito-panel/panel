import '@tanstack/react-start/server-only';
import type { Job } from 'pg-boss';
import { Recipe, RecipeRegistry, SshKey } from '~/db/entities';
import type { IRecipe, IRecipeRegistry, ISshKey } from '~/db/types';
import { parseRecipeJson } from '~/contract';
import { nanoid } from '~/lib/nanoid';
import {
  canonicalGitUrl,
  formatGitSource,
  parseRecipeSource,
  type GitRecipeSource,
  type RegistryEntry,
} from '~/lib/recipe-source';
import { orm, runWithOrmContext } from './orm';
import { HttpError } from './session';
import { decryptSecret } from './crypto';
import { requireSshKey } from './ssh-keys';
import { getQueue, startQueue } from './queue';
import { getSettingValue, writeSettings } from './settings';
import { buildRegistryEntries, canonicalRecipeHash, sha256Text } from './registry-entries';
import { cloneRecipeFiles, readGitFile } from './git-source';
import {
  fetchRecipeJsonFromUrl,
  normalizeRecipeUrl,
  requireRecipe,
  updateRecipe,
  upsertRecipe,
} from './recipes';

/**
 * Recipe marketplace service (server-only) — registries, syncs and the
 * unified recipe update checks.
 *
 * A REGISTRY is any public https git repository of recipes. Its sync is a
 * durable pg-boss job on the `marketplace-sync` queue:
 *
 *   - manual: "Sync now" (one registry) sends `{ registryId }` — collapsed by
 *     a 60 s singleton key so double-clicks cannot stack clones;
 *   - scheduled: a tick (60 s) sends the SWEEP job `{}` whenever the last
 *     check is older than the `marketplace:sync_interval` setting (0 =
 *     manual only) and no sweep is pending. The interval only owns the WHEN
 *     (same ownership split as the schedules runner) — pg-boss carries the
 *     work, so a sweep started before a restart finishes (or expires)
 *     durably, and the next tick re-fires it because `last_check` was not
 *     stamped.
 *
 * The sweep syncs every registry (clone → catalog → upstream hashes), then
 * checks the recipes no registry covers: direct-URL sources (fetched) and
 * git sources whose registry is gone (one clone per repository). Recipes
 * never change on their own — a check only stamps `remote_sha`; applying an
 * update is ALWAYS an explicit action.
 */

/** pg-boss queue carrying the registry syncs and the scheduled sweeps. */
const MARKETPLACE_QUEUE = 'marketplace-sync';

/**
 * Job options — no retries (the next tick or the next manual sync re-fires
 * a failed sync) and a bounded active window so a handler killed with the
 * process expires instead of hanging active forever.
 */
const JOB_OPTIONS = { retryLimit: 0, expireInSeconds: 1800 } as const;

/** How often the runner looks whether a sweep is due. */
const SWEEP_CHECK_INTERVAL_MS = 60_000;

/** True while a sweep job is queued or active (one panel process — same model as the schedules tick). */
let sweepPending = false;

// ─── Registries ───────────────────────────────────────────────────────────────

/** Creates a registry (canonical https git URL) and enqueues its first sync. */
export async function addRegistry(input: {
  name: string;
  url: string;
  branch: string;
  /** SSH key for a PRIVATE repository — '' / null = none (public https). */
  sshKeyId?: string | null;
}): Promise<IRecipeRegistry> {
  const em = orm.em;

  let url: string;
  try {
    url = canonicalGitUrl(input.url);
  } catch (err) {
    throw new HttpError(422, (err as Error).message);
  }

  const clash = await em.findOne(RecipeRegistry, { url });
  if (clash) {
    throw new HttpError(409, 'Ce dépôt est déjà enregistré comme registre');
  }

  // A key must exist when given ('' is the form's "none" sentinel).
  const sshKeyId = input.sshKeyId ? (await requireSshKey(input.sshKeyId)).id : null;

  const registry = em.create(RecipeRegistry, {
    id: nanoid(),
    name: input.name,
    url,
    branch: input.branch,
    branchName: '',
    entries: null,
    headSha: null,
    lastSyncedAt: null,
    lastError: null,
    sshKeyId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  em.persist(registry);
  await em.flush();

  await enqueueRegistrySync(registry.id);
  return registry;
}

/**
 * Edits a registry (name, tracked branch, SSH key — the URL is the row's
 * identity and never changes). A branch or key change invalidates the
 * cached catalog, so a sync is re-enqueued — it also validates the new
 * branch/key pairing immediately.
 */
export async function updateRegistry(input: {
  registryId: string;
  name: string;
  branch: string;
  /** SSH key for a PRIVATE repository — '' / null = none. */
  sshKeyId?: string | null;
}): Promise<{ synced: boolean }> {
  const em = orm.em;
  const registry = await em.findOne(RecipeRegistry, { id: input.registryId });
  if (!registry) throw new HttpError(404, 'Registre introuvable');

  const sshKeyId = input.sshKeyId ? (await requireSshKey(input.sshKeyId)).id : null;
  const authChanged = registry.sshKeyId !== sshKeyId;
  const branchChanged = registry.branch !== input.branch;

  registry.name = input.name;
  registry.branch = input.branch;
  registry.sshKeyId = sshKeyId;
  await em.flush();

  if (branchChanged || authChanged) {
    await enqueueRegistrySync(registry.id);
    return { synced: true };
  }
  return { synced: false };
}

/**
 * Deletes a registry. Its recipes KEEP their source URL (~/lib/recipe-source):
 * they stay checkable and updatable individually — the sweep clones the
 * repository directly when no registry matches anymore.
 */
export async function deleteRegistry(registryId: string): Promise<void> {
  const em = orm.em;
  const registry = await em.findOne(RecipeRegistry, { id: registryId });
  if (!registry) throw new HttpError(404, 'Registre introuvable');

  em.remove(registry);
  await em.flush();
}

/** Enqueues a manual sync of one registry (collapsed by a 60 s singleton key). */
export async function enqueueRegistrySync(registryId: string): Promise<void> {
  await getQueue().send(MARKETPLACE_QUEUE, { registryId }, {
    ...JOB_OPTIONS,
    singletonKey: `registry-sync-${registryId}`,
    singletonSeconds: 60,
  });
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

/**
 * Syncs one registry: clone depth 1, build the catalog, cache it on the
 * row and stamp the upstream hashes of the recipes imported from it. A
 * failure lands in `lastError` (the previous catalog stays readable).
 */
async function syncRegistryRow(registry: IRecipeRegistry): Promise<void> {
  const em = orm.em;
  try {
    const sshKey = await sshKeyOf(registry);
    const { files, headSha, branch } = await cloneRecipeFiles(
      registry.url,
      registry.branch,
      sshKey ? decryptSecret(sshKey.privateKey) : null,
    );

    const entries = buildRegistryEntries(files);
    registry.entries = entries;
    registry.headSha = headSha;
    registry.branchName = branch;
    registry.lastSyncedAt = new Date();
    registry.lastError = null;
    await em.flush();

    await stampRegistryRecipes(registry, entries);
  } catch (err) {
    registry.lastSyncedAt = new Date();
    registry.lastError = (err as Error).message;
    await em.flush();
  }
}

/**
 * The SSH key a registry clones with — null when the registry has none
 * (public https, or the panel host's own ssh configuration).
 */
async function sshKeyOf(registry: IRecipeRegistry): Promise<ISshKey | null> {
  if (!registry.sshKeyId) return null;
  return orm.em.findOne(SshKey, { id: registry.sshKeyId });
}

/**
 * Stamps the upstream hashes of every recipe imported from this registry
 * (matched by its source URL — `"<repo>#<branch>:<path>"`). A path that
 * disappeared upstream reads as null sha + a checked timestamp: "gone".
 */
async function stampRegistryRecipes(registry: IRecipeRegistry, entries: RegistryEntry[]): Promise<void> {
  if (!registry.branchName) return;

  const em = orm.em;
  const prefix = `${registry.url}#${registry.branchName}:`;
  const recipes = await em.find(Recipe, { sourceUrl: { $ne: null } });
  const bySourceUrl = new Map(entries.map((entry) => [`${prefix}${entry.path}`, entry]));
  const now = new Date();

  for (const recipe of recipes) {
    if (!recipe.sourceUrl?.startsWith(prefix)) continue;
    recipe.remoteSha = bySourceUrl.get(recipe.sourceUrl)?.sha ?? null;
    recipe.remoteCheckedAt = now;
  }
  await em.flush();
}

// ─── Imports & updates ────────────────────────────────────────────────────────

/**
 * Imports (or updates) one catalog entry in one click: the content comes
 * from the registry's cache (no clone), the recipe gets the git-form source
 * URL and the entry hash as its provenance stamp.
 *
 * A slug clash with a recipe from ANOTHER source is refused — overwriting
 * another origin silently is never OK.
 */
export async function importRegistryEntry(
  registryId: string,
  path: string,
): Promise<{ slug: string; name: string; created: boolean }> {
  const em = orm.em;
  const registry = await em.findOne(RecipeRegistry, { id: registryId });
  if (!registry) throw new HttpError(404, 'Registre introuvable');

  const entry = (registry.entries ?? []).find((candidate) => candidate.path === path);
  if (!entry) throw new HttpError(404, 'Fichier introuvable dans le registre');
  if (entry.error) throw new HttpError(422, `Recipe invalide : ${entry.error}`);
  if (!registry.branchName) throw new HttpError(409, 'Le registre n’est pas encore synchronisé');

  const recipeJson = parseRecipeJson(entry.content);
  const source = {
    url: formatGitSource(registry.url, registry.branchName, entry.path),
    sha: entry.sha,
  };

  const existing = await em.findOne(Recipe, { slug: recipeJson.id });
  if (existing && existing.sourceUrl !== source.url) {
    throw new HttpError(
      409,
      `La recette « ${recipeJson.id} » existe déjà avec une autre source — mets-la à jour depuis sa propre source, ou renomme-la d’abord`,
    );
  }

  return upsertRecipe(recipeJson, source);
}

/**
 * Updates one recipe from its source (the "Mettre à jour" action of
 * /admin/recipes): resolves the content — direct URL fetch, registry cache,
 * or a depth-1 clone when the registry is gone — validates it against the
 * contract and re-stamps the provenance columns. Falls back to the
 * recipe's own `update_url` for rows imported before provenance existed.
 */
export async function updateRecipeFromSource(
  recipeId: string,
): Promise<{ slug: string; name: string }> {
  const em = orm.em;
  const recipe = await requireRecipe(recipeId);

  const sourceUrl =
    recipe.sourceUrl ??
    (typeof recipe.json.update_url === 'string'
      ? normalizeRecipeUrl(recipe.json.update_url)
      : null);
  if (!sourceUrl) {
    throw new HttpError(422, 'Aucune source de mise à jour pour cette recette');
  }
  const source = parseRecipeSource(sourceUrl);
  if (!source) throw new HttpError(422, 'Source invalide');

  const raw =
    source.kind === 'direct'
      ? await fetchRecipeJsonFromUrl(source.url)
      : await readGitRecipeFile(source);

  const recipeJson = parseRecipeJson(raw);
  const sha = canonicalRecipeHash(recipeJson);

  await updateRecipe(recipeId, recipeJson);

  recipe.sourceUrl = sourceUrl;
  recipe.sourceSha = sha;
  recipe.remoteSha = sha;
  recipe.remoteCheckedAt = new Date();
  await em.flush();

  return { slug: recipe.slug, name: recipe.name };
}

/**
 * Reads one recipe file from a git source: the registry's catalog cache when
 * one matches the repository AND the branch, a depth-1 clone otherwise (the
 * registry was deleted, or switched branch after the import).
 */
async function readGitRecipeFile(source: GitRecipeSource): Promise<string> {
  const em = orm.em;
  const registry = await em.findOne(RecipeRegistry, { url: source.repoUrl });

  if (registry?.entries && registry.branchName === source.branch) {
    const entry = registry.entries.find((candidate) => candidate.path === source.path);
    if (entry) {
      if (entry.error) throw new HttpError(422, `Recipe invalide : ${entry.error}`);
      return entry.content;
    }
  }

  // No cached catalog — a direct clone, authenticated with the key of the
  // registry matching the repository (any branch of it) when there is one.
  const sshKey = await sshKeyOfRegistryUrl(source.repoUrl);
  const content = await readGitFile(
    source.repoUrl,
    source.branch,
    source.path,
    sshKey ? decryptSecret(sshKey.privateKey) : null,
  );
  if (content === null) throw new HttpError(404, 'Fichier source introuvable dans le dépôt');
  return content;
}

/**
 * The SSH key configured on ANY registry of this repository URL (any
 * branch) — a recipe's direct clone reuses its registry's credential. Null
 * when no registry of the repository carries a key.
 */
async function sshKeyOfRegistryUrl(repoUrl: string): Promise<ISshKey | null> {
  const registry = await orm.em.findOne(RecipeRegistry, { url: repoUrl, sshKeyId: { $ne: null } });
  if (!registry?.sshKeyId) return null;
  return orm.em.findOne(SshKey, { id: registry.sshKeyId });
}

// ─── Scheduled sweep ──────────────────────────────────────────────────────────

/**
 * The sweep: sync every registry, then check the recipes no registry
 * covers, then stamp `marketplace:last_check`. One registry failing never
 * stops the others — its error lands in its own row.
 */
async function runSweep(): Promise<void> {
  const em = orm.em;

  const registries = await em.find(RecipeRegistry, {});
  for (const registry of registries) {
    await syncRegistryRow(registry);
  }

  await checkUncoveredRecipeSources();
  await writeSettings(em, { 'marketplace:last_check': new Date().toISOString() });
}

/**
 * Enqueues the sweep when it is due: the interval setting is positive and
 * the last check is older than it. `sweepPending` keeps one sweep in flight
 * per process (the queue's singleton semantics do not fit a self-re-sending
 * chain — a pending flag on the single panel process does).
 */
async function maybeEnqueueSweep(): Promise<void> {
  if (sweepPending) return;

  const em = orm.em;
  const intervalMinutes = Number(await getSettingValue(em, 'marketplace:sync_interval'));
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const lastCheck = await getSettingValue(em, 'marketplace:last_check');
  const lastCheckedAt = lastCheck ? Date.parse(lastCheck) : 0;
  if (Date.now() - lastCheckedAt < intervalMinutes * 60_000) return;

  sweepPending = true;
  try {
    await getQueue().send(MARKETPLACE_QUEUE, {}, JOB_OPTIONS);
  } catch (err) {
    sweepPending = false;
    throw err;
  }
}

/**
 * Checks the recipes a registry sync did NOT cover:
 *
 * - direct sources: fetched (10 s timeout) — a fetch failure keeps the
 *   previous stamps ("last known state") instead of faking a check;
 * - git sources without their registry: grouped per repository, one clone
 *   for the whole group.
 */
async function checkUncoveredRecipeSources(): Promise<void> {
  const em = orm.em;
  const recipes = await em.find(Recipe, { sourceUrl: { $ne: null } });
  const registries = await em.find(RecipeRegistry, {});
  const now = new Date();

  const gitGroups = new Map<string, IRecipe[]>();

  for (const recipe of recipes) {
    const source = recipe.sourceUrl ? parseRecipeSource(recipe.sourceUrl) : null;
    if (!source) continue;

    if (source.kind === 'direct') {
      try {
        const raw = await fetchRecipeJsonFromUrl(source.url);
        recipe.remoteSha = canonicalRecipeHash(parseRecipeJson(raw));
        recipe.remoteCheckedAt = now;
      } catch {
        // Fetch failed — keep the previous stamps.
      }
      continue;
    }

    // Git sources: covered when a registry sync stamps them (same repository
    // AND the branch that sync resolved) — everything else is checked here.
    const covered = registries.some(
      (registry) => registry.url === source.repoUrl && registry.branchName === source.branch,
    );
    if (covered) continue;

    const key = `${source.repoUrl}#${source.branch}`;
    const group = gitGroups.get(key);
    if (group) group.push(recipe);
    else gitGroups.set(key, [recipe]);
  }
  await em.flush();

  // Per repository: the SSH key of ANY registry of that repository (any
  // branch) — the private credential outlives a branch change.
  const keyByUrl = new Map<string, string | null>();
  for (const registry of registries) {
    if (!registry.sshKeyId || keyByUrl.has(registry.url)) continue;
    const key = await em.findOne(SshKey, { id: registry.sshKeyId });
    keyByUrl.set(registry.url, key ? decryptSecret(key.privateKey) : null);
  }

  for (const [key, group] of gitGroups) {
    const separator = key.indexOf('#');
    const repoUrl = key.slice(0, separator);
    const branch = key.slice(separator + 1);

    let files: Array<{ path: string; content: string }>;
    try {
      const privateKey = keyByUrl.get(repoUrl) ?? null;
      ({ files } = await cloneRecipeFiles(
        repoUrl,
        branch === 'HEAD' ? '' : branch,
        privateKey,
      ));
    } catch {
      continue; // Clone failed — keep the previous stamps.
    }

    const byPath = new Map(files.map((file) => [file.path, file]));
    for (const recipe of group) {
      const source = parseRecipeSource(recipe.sourceUrl ?? '');
      if (source?.kind !== 'git') continue;
      const file = byPath.get(source.path);
      if (!file) {
        recipe.remoteSha = null; // Gone upstream.
      } else {
        try {
          recipe.remoteSha = canonicalRecipeHash(parseRecipeJson(file.content));
        } catch {
          // Upstream file no longer validates — its raw hash flags a change;
          // the update itself refuses with the parse error.
          recipe.remoteSha = sha256Text(file.content);
        }
      }
      recipe.remoteCheckedAt = now;
    }
    await em.flush();
  }
}

// ─── pg-boss worker & runner ──────────────────────────────────────────────────

/** Payload of a marketplace job: `{ registryId }` = one registry, `{}` = the sweep. */
interface MarketplaceJobData {
  registryId?: string;
}

async function runMarketplaceJob(data: MarketplaceJobData): Promise<void> {
  try {
    if (data.registryId) {
      const registry = await orm.em.findOne(RecipeRegistry, { id: data.registryId });
      if (registry) await syncRegistryRow(registry);
    } else {
      await runSweep();
    }
  } finally {
    if (!data.registryId) sweepPending = false;
  }
}

/** pg-boss work handler — one request context per job (batchSize is 1). */
async function handleMarketplaceJobs(jobs: Job<MarketplaceJobData>[]): Promise<void> {
  for (const job of jobs) {
    await runWithOrmContext(() => runMarketplaceJob(job.data));
  }
}

/**
 * Starts the marketplace runner: the pg-boss worker and the sweep-due tick.
 * Called once from `src/server.ts` after `startQueue()`.
 *
 * A global flag keeps ONE runner per process — dev SSR reloads re-evaluate
 * server modules and must not stack intervals on top of each other.
 */
export function startMarketplaceRunner(): void {
  const guard = globalThis as { __mojitoMarketplaceRunner?: boolean };
  if (guard.__mojitoMarketplaceRunner) return;
  guard.__mojitoMarketplaceRunner = true;

  void (async () => {
    const boss = await startQueue();
    // The queue must exist before the worker polls it (a fresh database has
    // none — send() would create it, but only at the first fire).
    await boss.createQueue(MARKETPLACE_QUEUE, JOB_OPTIONS);
    await boss.work(MARKETPLACE_QUEUE, { batchSize: 1 }, handleMarketplaceJobs);

    // Boot check, then the recurring tick — the tick only SENDS the sweep
    // job when one is due and none is pending (pg-boss carries the work).
    await runWithOrmContext(maybeEnqueueSweep);
    setInterval(() => {
      void runWithOrmContext(maybeEnqueueSweep).catch((error) =>
        console.error('[marketplace] sweep check failed:', error),
      );
    }, SWEEP_CHECK_INTERVAL_MS);

    console.log('[bootstrap] marketplace runner started');
  })().catch((error) => {
    console.error('[marketplace] runner failed to start:', error);
    guard.__mojitoMarketplaceRunner = false;
  });
}
