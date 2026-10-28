import '@tanstack/react-start/server-only';
import {
  isRuntimeRecipeJson,
  parseRecipe,
  parseRuntimeRecipe,
  recipeVariableSchema,
  type Recipe as RecipeDefinition,
  type RecipeVariable,
  type RuntimeRecipe,
} from '~/contract';
import { z } from 'zod';
import { nanoid } from '~/lib/nanoid';
import { recipeErrorMessage } from '~/lib/recipe-source';
import { Recipe, Server } from '~/db/entities';
import { orm } from './orm';
import { HttpError } from './session';

export { recipeErrorMessage };

/**
 * Recipe business service (server-only): plain functions doing all the DB
 * work of the admin Recipes pages, running inside the caller's MikroORM
 * request context (the `withOrmContext` middleware).
 */

/** Provenance stamp applied on import/update — see ~/lib/recipe-source. */
export interface RecipeSourceStamp {
  /** Canonical source URL (direct or git-fragment form). */
  url: string;
  /** Canonical hash of the imported content. */
  sha: string;
}

/**
 * Converts a github.com/…/blob/… URL to raw.githubusercontent.com/…/raw/…
 * (catalog GitHub URLs point to the web page, not the raw file).
 */
export function normalizeRecipeUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
    return `https://raw.githubusercontent.com${parsed.pathname.replace('/blob/', '/raw/')}${parsed.search}`;
  }
  return url;
}

/** Downloads a recipe's JSON from a URL (.json extension required). */
export async function fetchRecipeJsonFromUrl(url: string): Promise<string> {
  const normalized = normalizeRecipeUrl(url);
  if (!new URL(normalized).pathname.toLowerCase().endsWith('.json')) {
    throw new HttpError(400, 'Seules les URLs pointant vers un .json sont supportées');
  }
  let res: Response;
  try {
    res = await fetch(normalized, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new HttpError(502, `Téléchargement impossible : ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new HttpError(502, `Téléchargement échoué (HTTP ${res.status})`);
  }
  const body = await res.text();
  if (body.length > 2_000_000) {
    throw new HttpError(413, 'Fichier trop volumineux (> 2 Mo)');
  }
  return body;
}

/** Validates a raw recipe string, mapping the error to a 400 HttpError. */
export function assertValidRecipeJson(raw: string): RecipeDefinition | RuntimeRecipe {
  const parsed: unknown = JSON.parse(raw);
  if (isRuntimeRecipeJson(parsed)) {
    return parseRuntimeRecipe(parsed);
  }
  return parseRecipe(parsed);
}

/**
 * Creates the recipe or updates the one with the same slug (upsert —
 * a re-import updates the definition, like Pelican eggs). An optional
 * provenance stamp records WHERE the recipe came from and refreshes the
 * update-check columns (the imported content IS the upstream content).
 */
export async function upsertRecipe(
  recipeJson: RecipeDefinition | RuntimeRecipe,
  source?: RecipeSourceStamp,
): Promise<{ slug: string; name: string; created: boolean }> {
  const em = orm.em;
  const existing = await em.findOne(Recipe, { slug: recipeJson.id });
  const now = new Date();

  if (existing) {
    existing.name = recipeJson.name;
    existing.schemaVersion = recipeJson.schema_version;
    existing.json = recipeJson;
    if (source) {
      existing.sourceUrl = source.url;
      existing.sourceSha = source.sha;
      existing.remoteSha = source.sha;
      existing.remoteCheckedAt = now;
    }
    existing.updatedAt = now;
    await em.flush();
    return { slug: existing.slug, name: existing.name, created: false };
  }

  const recipe = em.create(Recipe, {
    id: nanoid(),
    slug: recipeJson.id,
    name: recipeJson.name,
    schemaVersion: recipeJson.schema_version,
    json: recipeJson,
    ...(source
      ? { sourceUrl: source.url, sourceSha: source.sha, remoteSha: source.sha, remoteCheckedAt: now }
      : {}),
    createdAt: now,
    updatedAt: now,
  });
  em.persist(recipe);
  await em.flush();
  return { slug: recipe.slug, name: recipe.name, created: true };
}

/**
 * Creates a new recipe from the editor UI. Unlike an import (upsert), a
 * slug clash is REJECTED — the editor shows the conflict instead of
 * silently overwriting. Hand-made recipes carry no provenance stamp.
 */
export async function createRecipe(
  recipeJson: RecipeDefinition | RuntimeRecipe,
): Promise<{ id: string; slug: string; name: string }> {
  const em = orm.em;

  const clash = await em.findOne(Recipe, { slug: recipeJson.id });
  if (clash) {
    throw new HttpError(409, `Une recette avec le slug « ${recipeJson.id} » existe déjà`);
  }

  const now = new Date();
  const recipe = em.create(Recipe, {
    id: nanoid(),
    slug: recipeJson.id,
    name: recipeJson.name,
    schemaVersion: recipeJson.schema_version,
    json: recipeJson,
    createdAt: now,
    updatedAt: now,
  });
  em.persist(recipe);
  await em.flush();

  return { id: recipe.id, slug: recipe.slug, name: recipe.name };
}

/**
 * Edits an existing recipe: the full JSON is revalidated against the
 * contract schema. The slug (id) can change — uniqueness is rechecked.
 * An edit via the editor is a LOCAL change: the provenance columns are left
 * alone so the next check flags it as "modified locally".
 */
export async function updateRecipe(
  recipeId: string,
  recipeJson: RecipeDefinition | RuntimeRecipe,
): Promise<{ id: string; slug: string; name: string }> {
  const em = orm.em;

  const recipe = await requireRecipe(recipeId);

  if (recipeJson.id !== recipe.slug) {
    const clash = await em.findOne(Recipe, { slug: recipeJson.id });
    if (clash) {
      throw new HttpError(409, `Une recette avec le slug « ${recipeJson.id} » existe déjà`);
    }
    recipe.slug = recipeJson.id;
  }

  recipe.name = recipeJson.name;
  recipe.schemaVersion = recipeJson.schema_version;
  recipe.json = recipeJson;
  recipe.updatedAt = new Date();
  await em.flush();

  return { id: recipe.id, slug: recipe.slug, name: recipe.name };
}

/** Loads a recipe (404 when unknown). */
export async function requireRecipe(recipeId: string) {
  const recipe = await orm.em.findOne(Recipe, { id: recipeId });
  if (!recipe) throw new HttpError(404, 'Recette introuvable');
  return recipe;
}

/** Deletes a recipe — refused while servers still use it. */
export async function deleteRecipe(recipeId: string): Promise<void> {
  const em = orm.em;
  const recipe = await requireRecipe(recipeId);

  const servers = await em.find(Server, { recipeId: recipe.id });
  if (servers.length > 0) {
    throw new HttpError(409, `${servers.length} serveur(s) utilisent cette recette`);
  }

  em.remove(recipe);
  await em.flush();
}

/**
 * Declared variables of a stored recipe JSON. The DB payload is untrusted, so
 * the variable array is validated against the contract (a malformed shape reads
 * as an empty list rather than crashing the list).
 */
export function storedRecipeVariables(json: Record<string, unknown>): RecipeVariable[] {
  return z.array(recipeVariableSchema).catch([]).parse(json.variables);
}
