import { z } from 'zod';

/**
 * Zod schema of the plugin (egg) — v2 format.
 * Feature parity with Pelican eggs (PTDL_v2), but declarative and Windows-first:
 * no Docker, no mandatory bash script (`script` action as an open fallback).
 *
 * `{{ENV_VAR}}` templating (UPPERCASE) everywhere: commands, files, URLs.
 * Resolution: agent system variables > server variables > plugin defaults > fixed env.
 */

// ─── System variables (reserved, provided by the agent at runtime) ───────────

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

// ─── Plugin variables (Pelican EggVariable equivalent) ─────────────────────

export const variableTypeSchema = z.enum(['string', 'number', 'boolean']);

export const pluginVariableSchema = z.object({
  /** Environment variable name (UPPERCASE) — templating + injection at spawn. */
  env: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Nom de variable invalide (UPPERCASE uniquement)')
    .refine(
      (v) => !RESERVED_ENV_NAMES.includes(v as ReservedEnvName),
      { message: 'Nom de variable systeme reservee' },
    ),
  /** Label shown in the panel. */
  name: z.string().min(1),
  description: z.string().optional(),
  type: variableTypeSchema,
  defaultValue: z.union([z.string(), z.number(), z.boolean()]),
  /** Visible to the user (otherwise: admin-only technical variable). */
  userViewable: z.boolean().default(true),
  /** Editable by the user (otherwise: read-only on the panel side). */
  userEditable: z.boolean().default(true),
  sort: z.number().int().default(0),
  required: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Value validation regex (Pelican's Laravel rules equivalent). */
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

// ─── Runner actions ────────────────────────────────────────────────────────

const downloadActionSchema = z.object({
  action: z.literal('download'),
  url: z.string().min(1),
  dest: z.string().min(1),
  /** SHA-256 of the file to verify integrity. */
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
 * Pelican's `config.files` equivalent: typed modification of config files
 * via a parser (properties, ini, yaml, json) — key -> templated value.
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
 * Open fallback: runs a script via a host shell.
 * For everything the declarative actions do not cover.
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

// ─── Graceful stop ────────────────────────────────────────────────────────────

export const stopConfigSchema = z.object({
  type: z.enum(['command', 'signal']),
  value: z.string().min(1),
  /** Delay before a force kill after the graceful stop. */
  timeoutMs: z.number().int().positive().default(30000),
});

export type StopConfig = z.infer<typeof stopConfigSchema>;

// ─── Ready detection (Pelican's config.startup equivalent: done + strip) ────

export const readyConfigSchema = z.object({
  /** String/regex indicating the server is ready. */
  pattern: z.string().min(1),
  /** Regex to strip from log lines before matching (ANSI colors, timestamps...). */
  strip: z.string().optional(),
});

export type ReadyConfig = z.infer<typeof readyConfigSchema>;

// ─── Logs (Pelican's config.logs equivalent) ─────────────────────────────────

export const logsConfigSchema = z.object({
  mode: z.enum(['stdout', 'file']).default('stdout'),
  /** Log file to follow (required if mode = file). */
  file: z.string().optional(),
  stripAnsi: z.boolean().default(false),
});

export type LogsConfig = z.infer<typeof logsConfigSchema>;

// ─── Runtime (replaces Pelican's docker_images — checked by the agent) ───────

/**
 * Host execution constraints, e.g. { "java": ">=21" }.
 * The agent checks availability before install/start.
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

// ─── Full plugin ───────────────────────────────────────────────────────────

export const pluginSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID invalide (minuscules, chiffres, tirets)'),
  name: z.string().min(1),
  author: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Pelican-style feature flags: eula, java_version, pid_limit... */
  features: z.array(z.string()).default([]),
  /** URL of a plugin update JSON (Pelican's meta.update_url equivalent). */
  updateUrl: z.string().url().optional(),
  requirements: pluginRequirementsSchema.optional(),
  runtime: runtimeSchema.optional(),
  variables: z.array(pluginVariableSchema).default([]),
  install: z.array(runnerActionSchema).default([]),
  start: startConfigSchema,
  logs: logsConfigSchema.optional(),
  /** Fixed environment variables injected at spawn. */
  env: z.record(z.string(), z.string()).optional(),
});

export type Plugin = z.infer<typeof pluginSchema>;

/** Input type of the plugin schema (fields with optional defaults). */
export type PluginInput = z.input<typeof pluginSchema>;

/** Input type of a runner action (fields with optional defaults). */
export type RunnerActionInput = z.input<typeof runnerActionSchema>;

// ─── Validation helpers ────────────────────────────────────────────────────

/**
 * Validates a raw JSON object as a plugin.
 * Throws a ZodError if invalid.
 */
export function parsePlugin(data: unknown): Plugin {
  return pluginSchema.parse(data);
}

/**
 * Validates a plugin and returns the result without throwing.
 */
export function safeParsePlugin(data: unknown) {
  return pluginSchema.safeParse(data);
}

/**
 * Extracts the variable names referenced in a `{{VAR}}` template.
 * UPPERCASE only — the agent's system variables are included.
 */
export function extractTemplateVars(template: string): string[] {
  const matches = template.matchAll(/\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/**
 * Checks that all variables used in the plugin's templates
 * are declared (plugin variables, system variables, or fixed env).
 * Returns the list of unknown variables.
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
 * Validates a plugin variable's value (Pelican's Laravel rules equivalent).
 * Returns an error message, or null if valid.
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
