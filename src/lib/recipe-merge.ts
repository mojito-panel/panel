import type { RecipeVariable } from '~/contract';

/**
 * Pure variable-merge helpers of the per-server recipe snapshot (see
 * `src/server/recipe-snapshot.ts`). Kept free of any server-only import
 * so they are unit-testable like the rest of `~/lib`.
 */

/**
 * Merged variable definitions: the app recipe's own first, then every
 * required runtime's — an env the app declares keeps the APP's definition
 * (flags included). A runtime-declared env becomes a server knob:
 * user-viewable and user-editable (the server owns the value it installs
 * with; the runtime's own flags only govern the standalone recipe).
 */
export function mergeVariableDefinitions(
  appVariables: RecipeVariable[],
  runtimeVariables: RecipeVariable[][],
): RecipeVariable[] {
  const merged: RecipeVariable[] = [...appVariables];
  const declared = new Set(appVariables.map((v) => v.env));
  for (const variables of runtimeVariables) {
    for (const variable of variables) {
      if (declared.has(variable.env)) continue;
      declared.add(variable.env);
      merged.push({ ...variable, user_viewable: true, user_editable: true });
    }
  }
  // Stable sort by the recipes' own sort field (app variables keep their
  // head start on ties).
  return merged
    .map((variable, index) => ({ variable, index }))
    .sort((a, b) => a.variable.sort - b.variable.sort || a.index - b.index)
    .map((entry) => entry.variable);
}

/**
 * Values of every merged definition: known values win, defaults fill the
 * rest — values of envs that are no longer defined drop out. Used at
 * install (submitted form values), on reload/change (current server
 * values) — the record always ends up covering exactly the definitions.
 */
export function mergeVariableValues(
  definitions: RecipeVariable[],
  values: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const merged: Record<string, string | number | boolean> = {};
  for (const definition of definitions) {
    const value = values[definition.env];
    merged[definition.env] = value === undefined || value === '' ? definition.default_value : value;
  }
  return merged;
}
