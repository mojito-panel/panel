import { RESERVED_ENV_NAMES, extractTemplateVars, type Plugin } from '@mojito/contract';

/**
 * System variables provided by the agent at runtime.
 * Reserved — cannot be overridden by the plugin or the server.
 */
export interface SystemVariables {
  SERVER_UUID: string;
  SERVER_NAME: string;
  /** Allocated RAM in MB. */
  SERVER_MEMORY: number;
  /** Main allocated port. */
  SERVER_PORT: number;
  SERVER_IP: string;
  SERVER_INSTALL_DIR: string;
}

/** All resolved variables for a server, ready for templating. */
export type ResolvedVariables = Map<string, string>;

/**
 * Resolves all variables of a server.
 * Priority (lowest to highest):
 *   1. plugin fixed env
 *   2. plugin variable defaults
 *   3. server values (override)
 *   4. system variables (reserved — override everything)
 */
export function resolveVariables(
  plugin: Plugin,
  serverVariables: Record<string, string | number | boolean>,
  systemVariables: SystemVariables,
): ResolvedVariables {
  const vars = new Map<string, string>();

  // 1. Fixed env (lowest priority)
  for (const [key, value] of Object.entries(plugin.env ?? {})) {
    vars.set(key, value);
  }

  // 2. Plugin defaults
  for (const variable of plugin.variables) {
    vars.set(variable.env, String(variable.defaultValue));
  }

  // 3. Server values (override defaults)
  for (const [key, value] of Object.entries(serverVariables)) {
    if (!RESERVED_ENV_NAMES.includes(key as never)) {
      vars.set(key, String(value));
    }
  }

  // 4. System variables (reserved — override everything)
  for (const name of RESERVED_ENV_NAMES) {
    const value = systemVariables[name];
    if (value !== undefined) {
      vars.set(name, String(value));
    }
  }

  return vars;
}

/**
 * Applies `{{VAR}}` templating to a string.
 * An unknown variable is an error (strict validation — fail at install,
 * not at runtime).
 */
export function render(template: string, vars: ResolvedVariables): string {
  const unknown = extractTemplateVars(template).filter((v) => !vars.has(v));
  if (unknown.length > 0) {
    throw new Error(`Variables inconnues dans le template : ${unknown.join(', ')}`);
  }
  return template.replace(
    /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g,
    (_, name: string) => vars.get(name) as string,
  );
}
