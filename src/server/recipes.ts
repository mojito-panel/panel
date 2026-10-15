import '@tanstack/react-start/server-only';
import { z, ZodError } from 'zod';
import { nanoid } from '~/lib/nanoid';
import { Recipe, Server } from '~/db/entities';
import { orm } from './orm';
import { HttpError } from './session';
import {
  parseRecipe,
  parseRuntimeRecipe,
  isRuntimeRecipeJson,
  recipeVariableSchema,
  type Recipe as RecipeDefinition,
  type RuntimeRecipe,
  type RecipeVariable,
} from '~/contract';

/**
 * Recipe business service (server-only): plain functions doing all the DB
 * work of the admin Recipes pages, running inside the caller's MikroORM
 * request context (the `withOrmContext` middleware).
 */

/** Parses raw JSON and validates it against the contract (app or runtime recipe). */
export function parseRecipeJson(raw: string): RecipeDefinition | RuntimeRecipe {
  const parsed: unknown = JSON.parse(raw);
  // Runtime recipes have their own schema (no start/backup) — dispatch
  // before the app schema, which rejects them (start is required there).
  if (isRuntimeRecipeJson(parsed)) {
    return parseRuntimeRecipe(parsed);
  }
  return parseRecipe(parsed);
}

/** Readable error message (ZodError → list of fields in error). */
export function recipeErrorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => `${i.path.join('.') || 'recipe'} : ${i.message}`).join(' · ');
  }
  return (err as Error).message;
}

/** Validates a raw recipe string, mapping the error to a 400 HttpError. */
export function assertValidRecipeJson(raw: string): RecipeDefinition | RuntimeRecipe {
  try {
    return parseRecipeJson(raw);
  } catch (err) {
    throw new HttpError(400, `Recipe invalide : ${recipeErrorMessage(err)}`);
  }
}

/**
 * Creates the recipe or updates the one with the same slug (upsert —
 * a re-import updates the definition, like Pelican eggs).
 */
export async function upsertRecipe(
  recipeJson: RecipeDefinition | RuntimeRecipe,
): Promise<{ slug: string; name: string; created: boolean }> {
  const em = orm.em;
  const existing = await em.findOne(Recipe, { slug: recipeJson.id });
  const now = new Date();

  if (existing) {
    existing.name = recipeJson.name;
    existing.schemaVersion = recipeJson.schemaVersion;
    existing.json = recipeJson;
    existing.updatedAt = now;
    await em.flush();
    return { slug: existing.slug, name: existing.name, created: false };
  }

  const recipe = em.create(Recipe, {
    id: nanoid(),
    slug: recipeJson.id,
    name: recipeJson.name,
    schemaVersion: recipeJson.schemaVersion,
    json: recipeJson,
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
 * silently overwriting.
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
    schemaVersion: recipeJson.schemaVersion,
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
  recipe.schemaVersion = recipeJson.schemaVersion;
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
