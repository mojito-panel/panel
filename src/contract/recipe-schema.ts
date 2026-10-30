import { z } from 'zod';

/**
 * Zod schema of the recipe (egg) — v4 format (the only one).
 * Feature parity with Pelican eggs (PTDL_v2), Windows-first: servers run
 * as native Windows processes (Job Object + dedicated user), the recipe
 * provisions its own runtimes (JDK, steamcmd) with declarative
 * `download`/`extract` actions into `.bin/…` — no docker image, no
 * mandatory bash script (`script` action as an open fallback,
 * powershell/cmd shells).
 *
 * `{{ENV_VAR}}` templating (UPPERCASE) everywhere: commands, files, URLs.
 * Resolution: agent system variables > server variables > recipe defaults > fixed env.
 */

// ─── System variables (reserved, provided by the agent at runtime) ───────────

export const RESERVED_ENV_NAMES = [
  'SERVER_UUID',
  'SERVER_NAME',
  'SERVER_MEMORY',
  'SERVER_PORT',
  'SERVER_IP',
  'SERVER_INSTALL_DIR',
  'RUNTIME_DIR',
] as const;

export type ReservedEnvName = (typeof RESERVED_ENV_NAMES)[number];

// ─── Recipe variables (Pelican EggVariable equivalent) ─────────────────────

export const variableTypeSchema = z.enum(['string', 'number', 'boolean']);

export const recipeVariableSchema = z.object({
  /** Environment variable name (UPPERCASE) — templating + injection at spawn. */
  env: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Nom de variable invalide (UPPERCASE uniquement)')
    .refine((v) => !RESERVED_ENV_NAMES.includes(v as ReservedEnvName), {
      message: 'Nom de variable systeme reservee',
    }),
  /** Label shown in the panel. */
  name: z.string().min(1),
  description: z.string().optional(),
  type: variableTypeSchema,
  default_value: z.union([z.string(), z.number(), z.boolean()]),
  /** Visible to the user (otherwise: admin-only technical variable). */
  user_viewable: z.boolean().default(true),
  /** Editable by the user (otherwise: read-only on the panel side). */
  user_editable: z.boolean().default(true),
  sort: z.number().int().default(0),
  required: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Value validation regex (Pelican's Laravel rules equivalent). */
  pattern: z.string().optional(),
  options: z.array(z.string()).optional(),
});

export type RecipeVariable = z.infer<typeof recipeVariableSchema>;

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
  strip_components: z.number().int().min(0).optional(),
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
 * Used by the install actions AND by the pre-start configs (`start.configs`).
 */
export const configFileActionSchema = z.object({
  action: z.literal('configFile'),
  file: z.string().min(1),
  parser: z.enum(['properties', 'ini', 'yaml', 'json']),
  find: z.record(z.string(), z.string()),
});

/**
 * Live progress from a log file the command writes while it runs.
 * On Windows the agent renders steamcmd's bare-`\r` progress live from
 * stdout; `tail` remains available for tools that only log their progress
 * to a file — the agent tails it and streams matching lines.
 */
const commandTailSchema = z.object({
  /** Log file (relative to the install dir, templated). */
  file: z.string().min(1),
  /** Regex source — only matching lines are streamed (default: all). */
  filter: z
    .string()
    .refine((v) => {
      try {
        new RegExp(v);
        return true;
      } catch {
        return false;
      }
    }, 'Regex de filtre invalide')
    .optional(),
  /** Poll interval in ms (default 1000). */
  interval_ms: z.number().int().min(100).max(10_000).optional(),
});

const commandActionSchema = z.object({
  action: z.literal('command'),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeout_ms: z.number().int().positive().optional(),
  /**
   * Exit codes treated as success (default: [0]).
   * e.g. steamcmd exits 7 after a self-update ("Update complete, launching...")
   * even when the requested job succeeded.
   */
  success_codes: z.array(z.number().int()).optional(),
  /** Tail a log file while the command runs (live progress, e.g. steamcmd). */
  tail: commandTailSchema.optional(),
});

/**
 * Open fallback: runs a script via a shell HOST-SIDE on the node —
 * powershell or cmd, under the server's dedicated user, inside a one-shot
 * Job Object. For everything the declarative actions do not cover.
 */
const scriptActionSchema = z.object({
  action: z.literal('script'),
  shell: z.enum(['powershell', 'cmd']),
  content: z.string().min(1),
  timeout_ms: z.number().int().positive().optional(),
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

/**
 * Signals a signal-type stop can deliver. POSIX names — the agent maps them
 * to the closest platform equivalent (CTRL_C_EVENT for SIGINT on Windows).
 * WM_CLOSE was removed: under the agent's dedicated-user model (batch
 * logon) a tree owns no window station and a GUI-subsystem server never
 * creates a window — the lever had nothing to close. GUI-subsystem servers
 * stop with SIGKILL (immediate whole-tree kill).
 */
export const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGKILL'] as const;
export type StopSignal = (typeof STOP_SIGNALS)[number];

const stopCommandConfigSchema = z.object({
  type: z.literal('command'),
  /** Command written to the server's stdin (e.g. "stop", "quit"). */
  value: z.string().min(1),
  /** Delay before a force kill after the graceful stop. */
  timeout_ms: z.number().int().positive().default(30000),
});

const stopSignalConfigSchema = z.object({
  type: z.literal('signal'),
  /** Signal sent to the server process instead of a stdin command. */
  value: z.enum(STOP_SIGNALS),
  /** Delay before a force kill after the graceful stop (SIGKILL skips it). */
  timeout_ms: z.number().int().positive().default(30000),
});

export const stopConfigSchema = z.discriminatedUnion('type', [
  stopCommandConfigSchema,
  stopSignalConfigSchema,
]);

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
  strip_ansi: z.boolean().default(false),
});

export type LogsConfig = z.infer<typeof logsConfigSchema>;

// ─── Backup (recipe-declared archive contents) ──────────────────────────────

/**
 * A backup include pattern: a RELATIVE POSIX path with optional glob
 * metacharacters (`*`, `?`, `[...]`, `{a,b}`) — expanded by the agent
 * against the server's installDir. Validated UP FRONT so a recipe cannot
 * smuggle an escape: no absolute path, no drive letter, no `.`/`..`
 * segment, no glob negation (`!`), no backslash, and no characters
 * Windows forbids in file names outside of the glob metacharacters.
 *
 * Defense in depth on the agent: patterns are expanded with symlink
 * following DISABLED and every match is re-checked against the install
 * root before entering the archive (see the agent's backup service).
 */

/** Characters forbidden in a glob pattern: control chars, Windows-illegal chars and glob negation — `\`, `!`, `"`, `|`, `<`, `>` are NOT glob metacharacters we support. */
// oxlint-disable-next-line no-control-regex -- control characters are rejected on purpose
const GLOB_FORBIDDEN_CHARS = /[\x00-\x1f<>:"|!\\]/;

/** Max length of one include pattern. */
export const BACKUP_INCLUDE_MAX_LENGTH = 512;

/** Max number of include patterns per recipe. */
export const BACKUP_INCLUDE_MAX_PATTERNS = 100;

/**
 * Validates one backup include pattern — returns a user-readable error
 * message (French, panel/editor display), or null when valid.
 */
export function validateBackupIncludePattern(pattern: string): string | null {
  if (pattern.length === 0) return 'Motif de sauvegarde vide';
  if (pattern.length > BACKUP_INCLUDE_MAX_LENGTH) {
    return `Motif de sauvegarde trop long (max ${BACKUP_INCLUDE_MAX_LENGTH} caractères)`;
  }
  if (pattern.startsWith('/')) return 'Chemin absolu interdit';
  for (const segment of pattern.split('/')) {
    if (segment.length === 0) return 'Segment vide dans le motif';
    if (segment === '.' || segment === '..') return 'Chemin interdit (. ou ..)';
    if (/^[a-zA-Z]:/.test(segment)) return 'Lettre de lecteur interdite';
    if (GLOB_FORBIDDEN_CHARS.test(segment)) return 'Caractère interdit dans le motif';
  }
  return null;
}

export const backupIncludePatternSchema = z
  .string()
  .refine((v) => validateBackupIncludePattern(v) === null, {
    message: 'Motif d’inclusion de sauvegarde invalide',
  });

export const backupConfigSchema = z.object({
  /**
   * Glob patterns of the files/directories included in a backup, relative
   * to the server root (`world`, `plugins/*`, `*.properties`). Absent → the
   * agent archives the whole install dir.
   */
  include: z.array(backupIncludePatternSchema).min(1).max(BACKUP_INCLUDE_MAX_PATTERNS),
});

export type BackupConfig = z.infer<typeof backupConfigSchema>;

// ─── Start ────────────────────────────────────────────────────────────────────

/**
 * Pre-start config update (Pelican's `config.files` / wings
 * `UpdateConfigurationFiles`): a typed find/replace applied to a file
 * BEFORE every spawn — the panel's variable edits reach the game at the
 * next start, without a reinstall. Same shape as the `configFile` install
 * action; a missing file is CREATED with the declared keys, every other
 * line (comments, unknown keys) is preserved.
 *
 * Errors are logged and never block the boot (wings' semantics: worst
 * case the server starts with a stale value, the user can fix it by hand).
 */
export const startConfigFileSchema = configFileActionSchema.omit({ action: true });

export type StartConfigFile = z.infer<typeof startConfigFileSchema>;

export const startConfigSchema = z.object({
  command: z.string().min(1),
  stop: stopConfigSchema.optional(),
  ready: readyConfigSchema.optional(),
  working_directory: z.string().optional(),
  /**
   * Config files re-applied before every start (see `startConfigFileSchema`).
   * Absent in a raw recipe JSON — the contract defaults it to `[]`.
   */
  configs: z.array(startConfigFileSchema).optional(),
});

export type StartConfig = z.infer<typeof startConfigSchema>;

// ─── Full recipe ────────────────────────────────────────────────────────────

export const recipeSchema = z.object({
  /** Recipe format version — v4 is the only supported one. */
  schema_version: z.literal(4),
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'ID invalide (minuscules, chiffres, tirets)'),
  /**
   * Recipe kind: 'app' (a game server, with start/backup) or 'runtime'
   * (a tool like java/steamcmd installed inside the app's install, no
   * start/backup). Runtime recipes are validated by `runtimeRecipeSchema`,
   * never here.
   */
  type: z.literal('app').default('app'),
  name: z.string().min(1),
  author: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** URL of a recipe update JSON (Pelican's meta.update_url equivalent). */
  update_url: z.string().url().optional(),
  variables: z.array(recipeVariableSchema).default([]),
  install: z.array(runnerActionSchema).default([]),
  start: startConfigSchema,
  logs: logsConfigSchema.optional(),
  /** Backup contents (glob include patterns) — absent = whole install dir. */
  backup: backupConfigSchema.optional(),
  /** Fixed environment variables injected at spawn. */
  env: z.record(z.string(), z.string()).optional(),
  /**
   * Runtime recipes this app requires (by their recipe id/slug) —
   * needed at INSTALL *and* RUN (any recipe change re-installs the
   * server, so there is no separate install-time-only lifecycle).
   * The panel resolves the ids against its recipe table and pushes the
   * resolved runtime recipes with the install request.
   */
  requires: z.array(z.string().regex(/^[a-z0-9-]+$/, 'ID de runtime invalide')).default([]),
});

export type Recipe = z.infer<typeof recipeSchema>;

// ─── Runtime recipes ────────────────────────────────────────────────────────

/**
 * What a runtime recipe exports to its dependents (the app and the other
 * runtimes that require it), templated with the runtime's own resolved
 * variables — `{{RUNTIME_DIR}}` points at the runtime's install dir.
 */
export const runtimeExportSchema = z.object({
  /**
   * Directory (RELATIVE to the runtime's install dir) whose executables are
   * prepended to the dependents' PATH — the runtime's layout is the recipe's
   * declaration, never the agent's guesswork: a JRE home exports "bin"
   * (java.exe lives in <home>\bin), steamcmd-style tools export ".".
   * Absent/empty = no PATH entry.
   */
  path: z
    .string()
    .refine(
      (p) =>
        p === '' ||
        (!/^[a-zA-Z]:/.test(p) &&
          !p.startsWith('/') &&
          !p.startsWith('\\') &&
          !p.split(/[/\\]/).includes('..')),
      'Dossier relatif au dossier du runtime (pas de lecteur, pas de "..")',
    )
    .optional(),
  /** Fixed env exported to the dependents (e.g. JAVA_HOME={{RUNTIME_DIR}}). */
  env: z.record(z.string(), z.string()).optional(),
});

export type RuntimeExport = z.infer<typeof runtimeExportSchema>;

/**
 * A RUNTIME recipe: a tool (java, steamcmd…) provisioned inside the
 * app's install by the SAME runner, under the SAME job limits and the
 * server's dedicated user — the agent carries no tool-specific code.
 * Minimal by contract: install steps + variables only, NO
 * start/logs/backup, no power actions of its own. A runtime may require
 * other runtimes.
 *
 * Variable resolution: SERVER variables win over the runtime's own
 * defaults — the app declares the user-facing JAVA_VERSION, the runtime
 * declares the fallback default; the agent merges server > runtime.
 */
export const runtimeRecipeSchema = z.object({
  schema_version: z.literal(4),
  type: z.literal('runtime'),
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'ID invalide (minuscules, chiffres, tirets)'),
  name: z.string().min(1),
  author: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  update_url: z.string().url().optional(),
  requires: z.array(z.string().regex(/^[a-z0-9-]+$/, 'ID de runtime invalide')).default([]),
  variables: z.array(recipeVariableSchema).default([]),
  install: z.array(runnerActionSchema).default([]),
  export: runtimeExportSchema.optional(),
});

export type RuntimeRecipe = z.infer<typeof runtimeRecipeSchema>;

/** Detects a runtime recipe BEFORE schema validation (dispatches the parse). */
export function isRuntimeRecipeJson(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).type === 'runtime'
  );
}

/** Validates a raw JSON object as a runtime recipe. Throws a ZodError. */
export function parseRuntimeRecipe(data: unknown): RuntimeRecipe {
  return runtimeRecipeSchema.parse(data);
}

/** Validates a raw JSON object as a runtime recipe, without throwing. */
export function safeParseRuntimeRecipe(data: unknown) {
  return runtimeRecipeSchema.safeParse(data);
}

/** Input type of the recipe schema (fields with optional defaults). */
export type RecipeInput = z.input<typeof recipeSchema>;

/** Input type of a runner action (fields with optional defaults). */
export type RunnerActionInput = z.input<typeof runnerActionSchema>;

// ─── Validation helpers ────────────────────────────────────────────────────

/**
 * Validates a raw JSON object as a recipe.
 * Throws a ZodError if invalid.
 */
export function parseRecipe(data: unknown): Recipe {
  return recipeSchema.parse(data);
}

/**
 * Validates a recipe and returns the result without throwing.
 */
export function safeParseRecipe(data: unknown) {
  return recipeSchema.safeParse(data);
}

/**
 * Parses raw JSON TEXT and validates it against the contract — a runtime
 * recipe (type: "runtime") is validated by its own schema, an app recipe by
 * the app schema. Throws (JSON.parse or ZodError) on invalid input.
 */
export function parseRecipeJson(raw: string): Recipe | RuntimeRecipe {
  const parsed: unknown = JSON.parse(raw);
  if (isRuntimeRecipeJson(parsed)) {
    return parseRuntimeRecipe(parsed);
  }
  return parseRecipe(parsed);
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
 * Checks that all variables used in the recipe's templates
 * are declared (recipe variables, system variables, or fixed env).
 * Returns the list of unknown variables.
 */
export function findUnknownVariables(recipe: Recipe): string[] {
  const declared = new Set<string>([
    ...recipe.variables.map((v) => v.env),
    ...RESERVED_ENV_NAMES,
    ...(recipe.env ? Object.keys(recipe.env) : []),
  ]);
  const used = new Set<string>();

  const collectFrom = (text: string) => {
    for (const v of extractTemplateVars(text)) used.add(v);
  };

  collectFrom(recipe.start.command);
  if (recipe.start.working_directory) collectFrom(recipe.start.working_directory);
  if (recipe.start.ready) collectFrom(recipe.start.ready.pattern);
  if (recipe.start.stop) collectFrom(recipe.start.stop.value);
  for (const config of recipe.start.configs ?? []) {
    collectFrom(config.file);
    for (const value of Object.values(config.find)) collectFrom(value);
  }

  for (const action of recipe.install) {
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
 * Validates a recipe variable's value (Pelican's Laravel rules equivalent).
 * Returns an error message, or null if valid.
 */
export function validateVariableValue(
  variable: RecipeVariable,
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
