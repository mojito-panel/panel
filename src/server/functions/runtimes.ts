/**
 * Runtime recipe resolution (contract): an app recipe's `requires` is a
 * list of runtime recipe ids (== their recipe slug). The panel resolves the
 * graph — transitively, cycle-checked — and pushes the resolved runtime
 * recipes with every install/reinstall request; the agent carries no
 * tool-specific code, it only knows how to install recipes.
 */
import type { EntityManager } from '@mikro-orm/core';
import { Recipe } from '~/db/entities';

export class RuntimeResolutionError extends Error {}

/**
 * Resolves an app recipe's runtime graph: every `requires` id, loaded by
 * slug, plus the runtimes those runtimes require. Returns the runtime
 * recipe JSONs in NO particular order (the agent sorts topologically and
 * validates the closure — the panel stays dumb about ordering).
 */
export async function resolveRuntimeRecipes(
  em: EntityManager,
  recipeJson: Record<string, unknown> | null | undefined,
): Promise<unknown[]> {
  const resolved: unknown[] = [];
  const seen = new Set<string>();
  const queue: string[] = Array.isArray(recipeJson?.requires)
    ? (recipeJson.requires as string[])
    : [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);

    const row = await em.findOne(Recipe, { slug: id });
    if (!row) {
      throw new RuntimeResolutionError(`Le runtime « ${id} » n'existe pas (recette introuvable)`);
    }
    const json = row.json as Record<string, unknown>;
    if (json?.type !== 'runtime') {
      throw new RuntimeResolutionError(
        `La recette « ${id} » n'est pas un runtime (type: ${String(json?.type)})`,
      );
    }
    resolved.push(json);
    if (Array.isArray(json.requires)) {
      queue.push(...(json.requires as string[]));
    }
    // Cycle guard: a runtime requiring itself transitively would loop
    // forever — `seen` above already breaks the walk, but a runtime
    // requiring itself is a recipe error worth failing loudly.
    if ((json.requires as string[] | undefined)?.includes(id)) {
      throw new RuntimeResolutionError(`Le runtime « ${id} » se requiert lui-même`);
    }
  }
  return resolved;
}
