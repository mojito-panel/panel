import { z } from 'zod';

/**
 * Schéma Zod du plugin (egg) — format v2.
 * A parite de features avec les eggs Pelican (PTDL_v2), mais declaratif et Windows-first :
 * pas de Docker, pas de script bash obligatoire (action `script` en fallback ouvert).
 *
 * Templating `{{ENV_VAR}}` (UPPERCASE) partout : commandes, fichiers, URLs.
 * Resolution : variables systeme de l'agent > variables du serveur > defaults du plugin > env fixe.
 */

// ─── Variables systeme (reservees, fournies par l'agent au runtime) ───────────

export const RESERVED_ENV_NAMES = [
  'SERVER_UUID',
  'SERVER_NAME',
  'SERVER_MEMORY',
  'SERVER_PORT',
  'SERVER_IP',
  'SERVER_INSTALL_DIR',
] as const;

export type ReservedEnvName = (typeof RESERVED_ENV_NAMES)[number];

export const SYSTEM_VARIABLES_SCHEMA = {
  SERVER_UUID: 'string — UUID du serveur',
  SERVER_NAME: 'string — nom du serveur',
  SERVER_MEMORY: 'number — RAM allouee en Mo',
  SERVER_PORT: 'number — port principal alloue',
  SERVER_IP: 'string — IP d ecoute (0.0.0.0 par defaut)',
  SERVER_INSTALL_DIR: 'string — dossier d installation du serveur',
} as const;

// ─── Variables du plugin (equivalent EggVariable Pelican) ─────────────────────

export const variableTypeSchema = z.enum(['string', 'number', 'boolean']);

export const pluginVariableSchema = z.object({
  /** Nom de la variable d environnement (UPPERCASE) — templating + injection au spawn. */
  env: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Nom de variable invalide (UPPERCASE uniquement)')
    .refine(
      (v) => !RESERVED_ENV_NAMES.includes(v as ReservedEnvName),
      { message: 'Nom de variable systeme reservee' },
    ),
  /** Libelle affiche dans le panel. */
  name: z.string().min(1),
  description: z.string().optional(),
  type: variableTypeSchema,
  defaultValue: z.union([z.string(), z.number(), z.boolean()]),
  /** Visible par l utilisateur (sinon : variable technique admin-only). */
  userViewable: z.boolean().default(true),
  /** Modifiable par l utilisateur (sinon : lecture seule cote panel). */
  userEditable: z.boolean().default(true),
  sort: z.number().int().default(0),
  required: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Regex de validation de la valeur (equivalent des rules Laravel de Pelican). */
  pattern: z.string().optional(),
  options: z.array(z.string()).optional(),
});

export type PluginVariable = z.infer<typeof pluginVariableSchema>;

// ─── Requirements ─────────────────────────────────────────────────────────────

export const pluginRequirementsSchema = z.object({
  minRamMb: z.number().int().positive().optional(),
  minDiskMb: z.number().int().positive().optional(),
  minCpuPercent: z.number().int().min(1).max(100).optional(),
  requiredCommands: z.array(z.string()).optional(),
});

export type PluginRequirements = z.infer<typeof pluginRequirementsSchema>;

// ─── Actions du runner ────────────────────────────────────────────────────────

const downloadActionSchema = z.object({
  action: z.literal('download'),
  url: z.string().min(1),
  dest: z.string().min(1),
  /** SHA-256 du fichier pour verifier l integrite. */
  checksum: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const extractActionSchema = z.object({
  action: z.literal('extract'),
  archive: z.string().min(1),
  dest: z.string().min(1),
  stripComponents: z.number().int().min(0).optional(),
});

const writeActionSchema = z.object({
  action: z.literal('write'),
  file: z.string().min(1),
  content: z.string(),
});

const replaceActionSchema = z.object({
  action: z.literal('replace'),
  file: z.string().min(1),
  find: z.string(),
  replace: z.string(),
  regex: z.boolean().default(false),
});

/**
 * Equivalent `config.files` de Pelican : modification typede de fichiers de config
 * via un parser (properties, ini, yaml, json) — cle -> valeur templatisee.
 */
const configFileActionSchema = z.object({
  action: z.literal('configFile'),
  file: z.string().min(1),
  parser: z.enum(['properties', 'ini', 'yaml', 'json']),
  find: z.record(z.string(), z.string()),
});

const commandActionSchema = z.object({
  action: z.literal('command'),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

/**
 * Fallback ouvert : execute un script via un shell de l hote.
 * Pour tout ce que les actions declaratives ne couvrent pas.
 */
const scriptActionSchema = z.object({
  action: z.literal('script'),
  shell: z.enum(['bash', 'powershell', 'cmd']),
  content: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
});

export const runnerActionSchema = z.discriminatedUnion('action', [
  downloadActionSchema,
  extractActionSchema,
  writeActionSchema,
  replaceActionSchema,
  configFileActionSchema,
  commandActionSchema,
  scriptActionSchema,
]);

export type RunnerAction = z.infer<typeof runnerActionSchema>;

// ─── Stop gracieux ────────────────────────────────────────────────────────────

export const stopConfigSchema = z.object({
  type: z.enum(['command', 'signal']),
  value: z.string().min(1),
  /** Delai avant kill force apres le stop gracieux. */
  timeoutMs: z.number().int().positive().default(30000),
});

export type StopConfig = z.infer<typeof stopConfigSchema>;

// ─── Ready detection (equivalent config.startup de Pelican : done + strip) ────

export const readyConfigSchema = z.object({
  /** Chaine/regex qui indique que le serveur est pret. */
  pattern: z.string().min(1),
  /** Regex a retirer des lignes de log avant matching (couleurs ANSI, timestamps...). */
  strip: z.string().optional(),
});

export type ReadyConfig = z.infer<typeof readyConfigSchema>;

// ─── Logs (equivalent config.logs de Pelican) ─────────────────────────────────

export const logsConfigSchema = z.object({
  mode: z.enum(['stdout', 'file']).default('stdout'),
  /** Fichier de log a suivre (requis si mode = file). */
  file: z.string().optional(),
  stripAnsi: z.boolean().default(false),
});

export type LogsConfig = z.infer<typeof logsConfigSchema>;

// ─── Runtime (remplace docker_images de Pelican — verifie par l agent) ───────

/**
 * Contraintes d execution de l hote, ex: { "java": ">=21" }.
 * L agent verifie la disponibilite avant install/start.
 */
export const runtimeSchema = z.record(z.string(), z.string());

export type Runtime = z.infer<typeof runtimeSchema>;

// ─── Start ────────────────────────────────────────────────────────────────────

export const startConfigSchema = z.object({
  command: z.string().min(1),
  stop: stopConfigSchema.optional(),
  ready: readyConfigSchema.optional(),
  workingDirectory: z.string().optional(),
});

export type StartConfig = z.infer<typeof startConfigSchema>;

// ─── Plugin complet ───────────────────────────────────────────────────────────

export const pluginSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID invalide (minuscules, chiffres, tirets)'),
  name: z.string().min(1),
  author: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Flags de features Pelican-style : eula, java_version, pid_limit... */
  features: z.array(z.string()).default([]),
  /** URL d un JSON de mise a jour du plugin (equivalent meta.update_url Pelican). */
  updateUrl: z.string().url().optional(),
  requirements: pluginRequirementsSchema.optional(),
  runtime: runtimeSchema.optional(),
  variables: z.array(pluginVariableSchema).default([]),
  install: z.array(runnerActionSchema).default([]),
  start: startConfigSchema,
  logs: logsConfigSchema.optional(),
  /** Variables d environnement fixes injectees au spawn. */
  env: z.record(z.string(), z.string()).optional(),
});

export type Plugin = z.infer<typeof pluginSchema>;

/** Type d'entrée du schéma plugin (champs avec defaults optionnels). */
export type PluginInput = z.input<typeof pluginSchema>;

/** Type d'entrée d'une action du runner (champs avec defaults optionnels). */
export type RunnerActionInput = z.input<typeof runnerActionSchema>;

// ─── Helpers de validation ────────────────────────────────────────────────────

/**
 * Valide un objet JSON brut comme plugin.
 * Lance une ZodError si invalide.
 */
export function parsePlugin(data: unknown): Plugin {
  return pluginSchema.parse(data);
}

/**
 * Valide un plugin et retourne le resultat sans lever d exception.
 */
export function safeParsePlugin(data: unknown) {
  return pluginSchema.safeParse(data);
}

/**
 * Extrait les noms de variables referencees dans un template `{{VAR}}`.
 * UPPERCASE uniquement — les variables systeme de l agent sont incluses.
 */
export function extractTemplateVars(template: string): string[] {
  const matches = template.matchAll(/\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/**
 * Verifie que toutes les variables utilisees dans les templates du plugin
 * sont declarees (variables du plugin, variables systeme, ou env fixe).
 * Retourne la liste des variables inconnues.
 */
export function findUnknownVariables(plugin: Plugin): string[] {
  const declared = new Set<string>([
    ...plugin.variables.map((v) => v.env),
    ...RESERVED_ENV_NAMES,
    ...(plugin.env ? Object.keys(plugin.env) : []),
  ]);
  const used = new Set<string>();

  const collectFrom = (text: string) => {
    for (const v of extractTemplateVars(text)) used.add(v);
  };

  collectFrom(plugin.start.command);
  if (plugin.start.workingDirectory) collectFrom(plugin.start.workingDirectory);
  if (plugin.start.ready) collectFrom(plugin.start.ready.pattern);
  if (plugin.start.stop) collectFrom(plugin.start.stop.value);

  for (const action of plugin.install) {
    if (action.action === 'download') {
      collectFrom(action.url);
      collectFrom(action.dest);
    }
    if (action.action === 'extract') {
      collectFrom(action.archive);
      collectFrom(action.dest);
    }
    if (action.action === 'write') {
      collectFrom(action.file);
      collectFrom(action.content);
    }
    if (action.action === 'replace') {
      collectFrom(action.file);
      collectFrom(action.find);
      collectFrom(action.replace);
    }
    if (action.action === 'configFile') {
      collectFrom(action.file);
      for (const value of Object.values(action.find)) collectFrom(value);
    }
    if (action.action === 'command') {
      collectFrom(action.command);
      if (action.cwd) collectFrom(action.cwd);
    }
    if (action.action === 'script') collectFrom(action.content);
  }

  return [...used].filter((v) => !declared.has(v));
}

/**
 * Valide la valeur d une variable du plugin (equivalent rules Laravel de Pelican).
 * Retourne un message d erreur ou null si valide.
 */
export function validateVariableValue(
  variable: PluginVariable,
  value: string | number | boolean,
): string | null {
  if (variable.type === 'number') {
    const num = Number(value);
    if (Number.isNaN(num)) return `${variable.name} doit etre un nombre`;
    if (variable.min !== undefined && num < variable.min)
      return `${variable.name} doit etre >= ${variable.min}`;
    if (variable.max !== undefined && num > variable.max)
      return `${variable.name} doit etre <= ${variable.max}`;
  }
  if (variable.pattern && typeof value === 'string') {
    if (!new RegExp(variable.pattern).test(value))
      return `${variable.name} ne respecte pas le format attendu`;
  }
  if (variable.options && !variable.options.includes(String(value))) {
    return `${variable.name} doit etre une des valeurs : ${variable.options.join(', ')}`;
  }
  return null;
}
