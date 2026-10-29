import '@tanstack/react-start/server-only';
import type { Job } from 'pg-boss';
import { Recipe, Registry, RegistryEntry, SshKey } from '~/db/entities';
import type { IRecipe, IRegistry, IRegistryEntry, ISshKey } from '~/db/types';
import { parseRecipeJson } from '~/contract';
import { nanoid } from '~/lib/nanoid';
import { parseRegistryManifest } from '~/lib/registry-manifest';
import {
  canonicalGitUrl,
  formatGitSource,
  isSameRegistryRecipe,
  parseRecipeSource,
  type GitRecipeSource,
} from '~/lib/recipe-source';
import { orm, runWithOrmContext } from './orm';
import { HttpError } from './session';
import { decryptSecret } from './crypto';
import { requireSshKey } from './ssh-keys';
import { getQueue, startQueue } from './queue';
import { getSettingValue, writeSettings } from './settings';
import {
  buildRegistryEntries,
  canonicalRecipeHash,
  sha256Text,
  type RegistryEntryDraft,
} from './registry-entries';
import { cloneRecipeFiles, readGitFile } from './git-source';
import {
  assertValidRecipeJson,
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
 * A REGISTRY is any git repository — public https or ssh, GitHub, GitLab,
 * Gitea, self-hosted… Its sync clones it depth 1, validates every recipe
 * file into `registry_entry` rows (delete + bulk insert per sync), caches
 * the repo-root cover on the row and stamps the upstream hashes of the
 * imported recipes. A failed sync keeps the previous catalog and lands its
 * error on the row. Its transport is a durable pg-boss job on the
 * `marketplace-sync` queue:
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
}): Promise<IRegistry> {
  const em = orm.em;

  let url: string;
  try {
    url = canonicalGitUrl(input.url);
  } catch (err) {
    throw new HttpError(422, (err as Error).message);
  }

  const clash = await em.findOne(Registry, { url });
  if (clash) {
    throw new HttpError(409, 'Ce dépôt est déjà enregistré comme registre');
  }

  // A key must exist when given ('' is the form's "none" sentinel).
  const sshKeyId = input.sshKeyId ? (await requireSshKey(input.sshKeyId)).id : null;

  const registry = em.create(Registry, {
    id: nanoid(),
    name: input.name,
    url,
    branch: input.branch,
    branchName: '',
    headSha: null,
    lastSyncedAt: null,
    lastError: null,
    sshKeyId,
    cover: null,
    description: null,
    author: null,
    license: null,
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
  const registry = await em.findOne(Registry, { id: input.registryId });
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
  const registry = await em.findOne(Registry, { id: registryId });
  if (!registry) throw new HttpError(404, 'Registre introuvable');

  // Loose ids (no FK cascade) — the catalog rows go with their registry.
  await em.nativeDelete(RegistryEntry, { registryId });
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
 * Syncs one registry: clone depth 1, validate every recipe file into
 * `registry_entry` rows (the previous set is REPLACED), cache the repo-root
 * cover on the row and stamp the upstream hashes of the recipes imported
 * from it. The registry stamp and the catalog replace are ONE transaction:
 * a failed insert rolls back to the previous catalog (delete + bulk insert
 * are never half-applied) and the failure lands in `lastError` while the
 * previous catalog stays readable.
 */
async function syncRegistryRow(registry: IRegistry): Promise<void> {
  const em = orm.em;
  try {
    const sshKey = await sshKeyOf(registry);
    const { files, headSha, branch, cover, manifest } = await cloneRecipeFiles(
      registry.url,
      registry.branch,
      sshKey ? decryptSecret(sshKey.privateKey) : null,
    );

    // The root registry.json is the registry MARKER: a repository without
    // one (or with an invalid one) is not a registry — the sync fails, the
    // previous catalog stays and lastError names the fix.
    if (manifest == null) {
      throw new Error('not a Mojito registry: registry.json is missing at the repository root');
    }
    const parsedManifest = parseRegistryManifest(manifest);

    const drafts = buildRegistryEntries(files);

    // ONE unit of work. The stamp goes through nativeUpdate on purpose: it
    // joins the transaction unconditionally, and on rollback the managed
    // entity stays PRISTINE — a later flush of the request context can
    // never persist a success stamp for a catalog that failed to replace.
    const now = new Date();
    await em.transactional(async (tem) => {
      await tem.nativeUpdate(Registry, { id: registry.id }, {
        cover,
        // Manifest metadata — stamped at every sync, the repo is the source
        // of truth (a field the manifest drops reads as null again).
        description: parsedManifest.description,
        author: parsedManifest.author ?? null,
        license: parsedManifest.license ?? null,
        headSha,
        branchName: branch,
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
      });
      // Inside the callback `orm.em` resolves to the transaction fork, so
      // the delete + bulk insert join the same unit.
      await replaceRegistryEntries(registry.id, drafts);
    });

    await stampRegistryRecipes(registry, branch, drafts);
  } catch (err) {
    // Previous catalog kept (rolled back), error recorded on the row.
    await em.nativeUpdate(Registry, { id: registry.id }, {
      lastSyncedAt: new Date(),
      lastError: (err as Error).message,
      updatedAt: new Date(),
    });
  }
}

/**
 * Replaces the catalog of one registry: every previous `registry_entry` row
 * goes, the fresh draft set is bulk-inserted (one flush). Runs INSIDE the
 * sync's transaction (see syncRegistryRow): a failed insert rolls back to
 * the previous catalog, so the delete + bulk insert are never half-applied.
 * The catalog is small (recipes repos carry dozens of files, not
 * thousands) and the sync is never hot — a wholesale replace keeps the
 * table strictly equal to the last clone, with no diff logic to get wrong.
 */
async function replaceRegistryEntries(registryId: string, drafts: RegistryEntryDraft[]): Promise<void> {
  const em = orm.em;
  await em.nativeDelete(RegistryEntry, { registryId });

  const now = new Date();
  for (const draft of drafts) {
    em.persist(
      em.create(RegistryEntry, {
        id: nanoid(),
        registryId,
        path: draft.path,
        sha: draft.sha,
        slug: draft.slug,
        name: draft.name,
        type: draft.type,
        description: draft.description,
        error: draft.error,
        cover: draft.cover,
        content: draft.content,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  await em.flush();
}

/**
 * The SSH key a registry clones with — null when the registry has none
 * (public https, or the panel host's own ssh configuration).
 */
async function sshKeyOf(registry: IRegistry): Promise<ISshKey | null> {
  if (!registry.sshKeyId) return null;
  return orm.em.findOne(SshKey, { id: registry.sshKeyId });
}

/**
 * Stamps the upstream hashes of every recipe imported from this registry.
 * The scope is the source URL prefix of the branch the sync just resolved
 * (passed explicitly: the sync wrote it via nativeUpdate, so the in-memory
 * row the caller holds may be stale). Matching is REGISTRY + RECIPE ID
 * (`isSameRegistryRecipe`) — never the path: a file renamed upstream is
 * still the same recipe, so the stamp follows it AND the recipe's source
 * URL is re-pointed to the new path, keeping later checks and updates
 * resolvable. Only the LIGHT entry columns are read (path/sha — never the
 * cached file contents). A recipe no entry matches anymore (by id, or by
 * path for an id-less file) reads as null sha + a checked timestamp: "gone".
 */
async function stampRegistryRecipes(
  registry: IRegistry,
  branchName: string,
  drafts: RegistryEntryDraft[],
): Promise<void> {
  if (!branchName) return;

  const em = orm.em;
  const prefix = `${registry.url}#${branchName}:`;
  const scope = { url: registry.url, branchName };
  const recipes = await em.find(Recipe, { sourceUrl: { $ne: null } });
  const now = new Date();

  for (const recipe of recipes) {
    const sourceUrl = recipe.sourceUrl;
    if (!sourceUrl?.startsWith(prefix)) continue;
    const probe = { slug: recipe.slug, sourceUrl };
    const draft = drafts.find((candidate) => isSameRegistryRecipe(scope, candidate, probe));
    if (!draft) {
      recipe.remoteSha = null; // Gone upstream — no entry of this id anymore.
    } else {
      recipe.remoteSha = draft.sha;
      if (draft.path !== sourceUrl.slice(prefix.length)) {
        recipe.sourceUrl = `${prefix}${draft.path}`;
      }
    }
    recipe.remoteCheckedAt = now;
  }
  await em.flush();
}

// ─── Imports & updates ────────────────────────────────────────────────────────

/** Outcome of one recipe import of the cascade. */
export interface ImportedDependency {
  slug: string;
  name: string;
  created: boolean;
}

/** Light catalog row of the import cascade — everything except the content. */
interface LightRegistryEntry {
  path: string;
  sha: string;
  slug: string | null;
  error: string | null;
}

/** Report of a one-click registry import: the recipe + its imported requirements. */
export interface RegistryImportReport {
  slug: string;
  name: string;
  created: boolean;
  /** Requirements imported along (each recipe the panel did not have yet). */
  imported: ImportedDependency[];
  /**
   * Requirement ids found NOWHERE — neither an existing local recipe nor an
   * entry of the same registry. The install would fail on them.
   */
  missing: string[];
}

/**
 * Imports (or updates) one catalog entry in one click — WITH its runtimes:
 * every recipe the target `requires` is resolved transitively from the SAME
 * registry (an existing local recipe by slug satisfies the requirement, an
 * entry of the registry is imported along, anything else lands in
 * `missing`). The catalog is read with LIGHT columns only (the cached file
 * contents are fetched per imported entry, on demand); each recipe gets
 * the git-form source URL and the entry hash as its provenance stamp.
 *
 * A slug clash with a recipe from ANOTHER source is refused — overwriting
 * another origin silently is never OK. The same registry + branch + recipe
 * id IS the same origin however (the file path is not part of the
 * identity): re-importing a renamed file updates the local copy and
 * re-points its provenance to the new path.
 */
export async function importRegistryEntry(
  registryId: string,
  path: string,
): Promise<RegistryImportReport> {
  const em = orm.em;
  const registry = await em.findOne(Registry, { id: registryId });
  if (!registry) throw new HttpError(404, 'Registre introuvable');
  if (!registry.branchName) throw new HttpError(409, 'Le registre n’est pas encore synchronisé');

  /**
   * The registry's catalog, LIGHT columns only (everything except the
   * cached file content) — slug resolution never reads the contents;
   * each imported entry fetches its own on demand below.
   */
  const entries: LightRegistryEntry[] = (await em.find(RegistryEntry, { registryId }, { exclude: ['content'] })).map((entry) => ({
    path: entry.path,
    sha: entry.sha,
    slug: entry.slug ?? null,
    error: entry.error ?? null,
  }));
  const entryBySlug = new Map(
    entries
      .filter((entry) => entry.slug !== null && !entry.error)
      .map((entry) => [entry.slug as string, entry]),
  );

  /** Imports one entry, cascading into ITS requirements (DFS, cycle-safe). */
  const imported = new Map<string, ImportedDependency>();
  const missing = new Set<string>();
  const inProgress = new Set<string>();

  const importOne = async (entry: LightRegistryEntry): Promise<void> => {
    // On-demand content fetch — only the imported entries load their cached
    // file (`refresh` because the light list above left a partial entity in
    // the identity map). Validated through assertValidRecipeJson so an
    // unknown template variable fails HERE, not on the agent.
    const row = await em.findOne(
      RegistryEntry,
      { registryId, path: entry.path },
      { refresh: true },
    );
    if (!row) throw new HttpError(404, 'Fichier introuvable dans le registre');
    const recipeJson = assertValidRecipeJson(row.content);
    const source = {
      url: formatGitSource(registry.url, registry.branchName as string, entry.path),
      sha: entry.sha,
    };

    const existing = await em.findOne(Recipe, { slug: recipeJson.id });
    if (existing) {
      const existingSource = existing.sourceUrl ? parseRecipeSource(existing.sourceUrl) : null;
      const sameOrigin =
        existingSource?.kind === 'git' &&
        existingSource.repoUrl === registry.url &&
        existingSource.branch === registry.branchName;
      if (!sameOrigin) {
        throw new HttpError(
          409,
          `La recette « ${recipeJson.id} » existe déjà avec une autre source — mets-la à jour depuis sa propre source, ou renomme-la d’abord`,
        );
      }
    }

    const result = await upsertRecipe(recipeJson, source);
    imported.set(recipeJson.id, result);

    for (const requiredId of recipeJson.requires) {
      await resolveRequirement(requiredId);
    }
  };

  /** Satisfies one `requires` id: local recipe, same-registry entry, or missing. */
  const resolveRequirement = async (requiredId: string): Promise<void> => {
    if (imported.has(requiredId)) return; // Imported during this cascade.
    if (inProgress.has(requiredId)) return; // Cycle — the outer import finishes it.

    const local = await em.findOne(Recipe, { slug: requiredId });
    if (local) return; // Already installed.

    const entry = entryBySlug.get(requiredId);
    if (!entry) {
      missing.add(requiredId);
      return;
    }

    inProgress.add(requiredId);
    try {
      await importOne(entry);
    } finally {
      inProgress.delete(requiredId);
    }
  };

  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) throw new HttpError(404, 'Fichier introuvable dans le registre');
  if (entry.error) throw new HttpError(422, `Recipe invalide : ${entry.error}`);

  inProgress.add(entry.slug ?? path);
  try {
    await importOne(entry);
  } finally {
    inProgress.clear();
  }

  const main = imported.get(entry.slug ?? '') ?? { slug: '', name: '', created: false };
  return {
    slug: main.slug,
    name: main.name,
    created: main.created,
    imported: [...imported.values()].filter((dependency) => dependency.slug !== main.slug),
    missing: [...missing],
  };
}

/**
 * Reads ONE catalog entry (with its cached file content) — the "view JSON"
 * dialog of the catalog page. The list queries exclude the content column;
 * this fetches a single entry on demand.
 */
export async function getRegistryEntry(
  registryId: string,
  path: string,
): Promise<{ path: string; content: string }> {
  const entry = await orm.em.findOne(RegistryEntry, { registryId, path });
  if (!entry) throw new HttpError(404, 'Fichier introuvable dans le registre');
  return { path: entry.path, content: entry.content };
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

  const recipeJson = assertValidRecipeJson(raw);
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
  const registry = await em.findOne(Registry, { url: source.repoUrl });

  if (registry && registry.branchName === source.branch) {
    const entry = await em.findOne(RegistryEntry, {
      registryId: registry.id,
      path: source.path,
    });
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
  const registry = await orm.em.findOne(Registry, { url: repoUrl, sshKeyId: { $ne: null } });
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

  const registries = await em.find(Registry, {});
  for (const registry of registries) {
    await syncRegistryRow(registry);
  }

  await checkUncoveredRecipeSources();
  await writeSettings({ 'marketplace:last_check': new Date().toISOString() });
}

/**
 * Enqueues the sweep when it is due: the interval setting is positive and
 * the last check is older than it. `sweepPending` keeps one sweep in flight
 * per process (the queue's singleton semantics do not fit a self-re-sending
 * chain — a pending flag on the single panel process does).
 */
async function maybeEnqueueSweep(): Promise<void> {
  if (sweepPending) return;

  const intervalMinutes = Number(await getSettingValue('marketplace:sync_interval'));
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;

  const lastCheck = await getSettingValue('marketplace:last_check');
  const lastCheckedAt = lastCheck ? Date.parse(lastCheck) : 0;
  if (Date.now() - lastCheckedAt < intervalMinutes * 60_000) return;

  sweepPending = true;
  try {
    // Same singleton semantics as a manual sync, keyed per JOB instead of
    // per registry: a sweep and a manual sync of the same registry can no
    // longer race each other into a unique-constraint violation, and two
    // sweeps cannot stack within the collapse window either.
    await getQueue().send(MARKETPLACE_QUEUE, {}, {
      ...JOB_OPTIONS,
      singletonKey: 'marketplace-sweep',
      singletonSeconds: 60,
    });
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
  const registries = await em.find(Registry, {});
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
      const registry = await orm.em.findOne(Registry, { id: data.registryId });
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
