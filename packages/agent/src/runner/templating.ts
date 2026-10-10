import { RESERVED_ENV_NAMES, extractTemplateVars, type Plugin } from '@mojito/contract';

/**
 * Variables système fournies par l'agent au runtime.
 * Réservées — non surchargeables par le plugin ni par le serveur.
 */
export interface SystemVariables {
  SERVER_UUID: string;
  SERVER_NAME: string;
  /** RAM allouée en Mo. */
  SERVER_MEMORY: number;
  /** Port principal alloué. */
  SERVER_PORT: number;
  SERVER_IP: string;
  SERVER_INSTALL_DIR: string;
}

/** Toutes les variables résolues pour un serveur, prêtes pour le templating. */
export type ResolvedVariables = Map<string, string>;

/**
 * Résout toutes les variables d'un serveur.
 * Priorité (du plus faible au plus fort) :
 *   1. env fixe du plugin
 *   2. defaults des variables du plugin
 *   3. valeurs du serveur (override)
 *   4. variables système (réservées — écrasent tout)
 */
export function resolveVariables(
  plugin: Plugin,
  serverVariables: Record<string, string | number | boolean>,
  systemVariables: SystemVariables,
): ResolvedVariables {
  const vars = new Map<string, string>();

  // 1. Env fixe (priorité la plus basse)
  for (const [key, value] of Object.entries(plugin.env ?? {})) {
    vars.set(key, value);
  }

  // 2. Defaults du plugin
  for (const variable of plugin.variables) {
    vars.set(variable.env, String(variable.defaultValue));
  }

  // 3. Valeurs du serveur (override les defaults)
  for (const [key, value] of Object.entries(serverVariables)) {
    if (!RESERVED_ENV_NAMES.includes(key as never)) {
      vars.set(key, String(value));
    }
  }

  // 4. Variables système (réservées — écrasent tout)
  for (const name of RESERVED_ENV_NAMES) {
    const value = systemVariables[name];
    if (value !== undefined) {
      vars.set(name, String(value));
    }
  }

  return vars;
}

/**
 * Applique le templating `{{VAR}}` sur une chaîne.
 * Une variable inconnue est une erreur (validation stricte — échec à l'installation,
 * pas au runtime).
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
