import { z } from 'zod';
import {
  RESERVED_ENV_NAMES,
  STOP_SIGNALS,
  safeParseRecipe,
  validateBackupIncludePattern,
  type Recipe,
  type RunnerAction,
  type RunnerActionInput,
  type StopSignal,
} from '~/contract';

/**
 * Form value + Zod schema for the recipe editor (Pelican-style egg editor).
 *
 * The editor value is a "fully populated" shape: every optional contract field
 * exists in the form (empty string / null / [] = absent) so that TanStack Form
 * field names are stable. `recipeEditorValueToRecipe` strips the empties and
 * produces the final recipe JSON; the server revalidates it with `parseRecipe`.
 *
 * No `z.default()`/`z.coerce()` — required by the TanStack Form Standard
 * Schema typing (see AGENTS.md).
 */

// ─── Key/value pairs (Records in the contract, pairs in the form) ───────────

export const kvPairSchema = z.object({
  key: z.string().min(1, 'Clé requise'),
  value: z.string(),
});

export type KvPair = z.infer<typeof kvPairSchema>;

// ─── Variables ───────────────────────────────────────────────────────────────

export const variableTypeSchema = z.enum(['string', 'number', 'boolean']);

export const recipeVariableValueSchema = z.object({
  name: z.string().min(1, 'Nom requis'),
  env: z
    .string()
    .min(1, 'Variable d\u2019environnement requise')
    .regex(/^[A-Z][A-Z0-9_]*$/, 'UPPERCASE uniquement (A-Z, 0-9, _)')
    .refine((v) => !RESERVED_ENV_NAMES.includes(v as (typeof RESERVED_ENV_NAMES)[number]), {
      message: 'Nom de variable système réservée',
    }),
  description: z.string(),
  type: variableTypeSchema,
  /** Stringified in the input, typed on change (number/boolean kept native). */
  defaultValue: z.union([z.string(), z.number(), z.boolean()]),
  userViewable: z.boolean(),
  userEditable: z.boolean(),
  sort: z.number().int().min(0),
  required: z.boolean(),
  /** 0 = absent (contract: number min). */
  min: z.number(),
  max: z.number(),
  /** Validation regex (contract `pattern`). */
  pattern: z.string(),
  /** Allowed values (comma input). */
  options: z.array(z.string()),
});

export type RecipeVariableValue = z.infer<typeof recipeVariableValueSchema>;

export function newVariableValue(sort: number): RecipeVariableValue {
  return {
    name: '',
    env: '',
    description: '',
    type: 'string',
    defaultValue: '',
    userViewable: true,
    userEditable: true,
    sort,
    required: false,
    min: 0,
    max: 0,
    pattern: '',
    options: [],
  };
}

// ─── Install actions ─────────────────────────────────────────────────────────

export const actionTypeSchema = z.enum([
  'download',
  'extract',
  'write',
  'replace',
  'configFile',
  'command',
  'script',
]);

export type ActionType = z.infer<typeof actionTypeSchema>;

/**
 * All the fields of every action type merged into ONE flat object —
 * per-action rendering shows only the relevant fields, validation
 * (superRefine) enforces the right ones, and TanStack Form field names
 * stay uniform (`install[i].url`…) regardless of the action type.
 */
export const actionValueSchema = z
  .object({
    action: actionTypeSchema,
    // download
    url: z.string(),
    dest: z.string(),
    checksum: z.string(),
    headers: z.array(kvPairSchema),
    // extract
    archive: z.string(),
    stripComponents: z.number().int().min(0),
    // write
    file: z.string(),
    content: z.string(),
    // replace
    find: z.string(),
    replace: z.string(),
    regex: z.boolean(),
    // configFile
    parser: z.enum(['properties', 'ini', 'yaml', 'json']),
    configFind: z.array(kvPairSchema),
    // command
    command: z.string(),
    cwd: z.string(),
    env: z.array(kvPairSchema),
    /** 0 = absent (contract: positive). */
    timeoutMs: z.number().int().min(0),
    successCodes: z.array(z.string()),
    tail: z
      .object({
        file: z.string(),
        filter: z.string(),
        intervalMs: z.number().int().min(0),
      })
      .nullable(),
    // script
    shell: z.enum(['powershell', 'cmd']),
  })
  .superRefine((action, ctx) => {
    const require = (field: string, message: string) => {
      if (!action[field as keyof typeof action]) {
        ctx.addIssue({ code: 'custom', path: [field], message });
      }
    };
    const invalidRegex = (field: string, source: string, message: string) => {
      try {
        new RegExp(source);
      } catch {
        ctx.addIssue({ code: 'custom', path: [field], message });
      }
    };

    switch (action.action) {
      case 'download':
        require('url', 'URL requise');
        require('dest', 'Destination requise');
        break;
      case 'extract':
        require('archive', 'Archive requise');
        require('dest', 'Destination requise');
        break;
      case 'write':
        require('file', 'Fichier requis');
        break;
      case 'replace':
        require('file', 'Fichier requis');
        require('find', 'Texte à trouver requis');
        break;
      case 'configFile':
        require('file', 'Fichier requis');
        if (action.configFind.length === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['configFind'],
            message: 'Au moins une clé à modifier est requise',
          });
        }
        break;
      case 'command':
        require('command', 'Commande requise');
        break;
      case 'script':
        require('content', 'Script requis');
        break;
    }

    if (action.tail) {
      if (!action.tail.file) {
        ctx.addIssue({ code: 'custom', path: ['tail', 'file'], message: 'Fichier de log requis' });
      }
      if (action.tail.filter) {
        invalidRegex('tail', action.tail.filter, 'Regex de filtre invalide');
      }
    }
  });

export type ActionValue = z.infer<typeof actionValueSchema>;

const ACTION_LABELS: Record<ActionType, string> = {
  download: 'Téléchargement',
  extract: 'Extraction',
  write: 'Écriture de fichier',
  replace: 'Remplacement',
  configFile: 'Fichier de config',
  command: 'Commande',
  script: 'Script',
};

export function actionLabel(action: ActionType): string {
  return ACTION_LABELS[action];
}

export function newActionValue(action: ActionType): ActionValue {
  return {
    action,
    url: '',
    dest: '',
    checksum: '',
    headers: [],
    archive: '',
    stripComponents: 0,
    file: '',
    content: '',
    find: '',
    replace: '',
    regex: false,
    parser: 'properties',
    configFind: [],
    command: '',
    cwd: '',
    env: [],
    timeoutMs: 0,
    successCodes: [],
    tail: null,
    shell: 'powershell',
  };
}

// ─── Stop / ready / logs ─────────────────────────────────────────────────────

export const stopValueSchema = z
  .object({
    type: z.enum(['command', 'signal']),
    value: z.string().min(1, 'Commande/signal requis'),
    timeoutMs: z.number().int().min(0),
  })
  .superRefine((stop, ctx) => {
    if (stop.type === 'signal' && !STOP_SIGNALS.includes(stop.value as StopSignal)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Signal invalide (SIGINT, SIGTERM ou SIGKILL)',
      });
    }
  });

export type StopValue = z.infer<typeof stopValueSchema>;

export const readyValueSchema = z.object({
  pattern: z.string().min(1, 'Pattern requis'),
  strip: z.string(),
});

export type ReadyValue = z.infer<typeof readyValueSchema>;

export const logsValueSchema = z.object({
  mode: z.enum(['stdout', 'file']),
  file: z.string(),
  stripAnsi: z.boolean(),
});

export type LogsValue = z.infer<typeof logsValueSchema>;

// ─── Requirements ────────────────────────────────────────────────────────────

export const requirementsValueSchema = z.object({
  /** 0 = absent. */
  minRamMb: z.number().int().min(0),
  minDiskMb: z.number().int().min(0),
  minCpuPercent: z.number().int().min(0).max(100),
  requiredCommands: z.array(z.string()),
});

export type RequirementsValue = z.infer<typeof requirementsValueSchema>;

// ─── Backup (glob include patterns) ──────────────────────────────────────────

export const backupValueSchema = z.object({
  /** Empty list = whole install dir (the agent always excludes its .bin/). */
  include: z.array(z.string()),
});

export type BackupValue = z.infer<typeof backupValueSchema>;

// ─── Full editor value ───────────────────────────────────────────────────────

/**
 * Cross-field checks shared by the editor schemas: duplicate variable
 * envs, invalid variable patterns, update URL.
 */
function refineEditorValue(
  value: {
    variables: RecipeVariableValue[];
    updateUrl: string;
  },
  ctx: z.RefinementCtx,
): void {
  // Duplicate recipe variable envs → error on each duplicate item
  const seen = new Map<string, number>();
  value.variables.forEach((variable, index) => {
    if (!variable.env) return;
    const first = seen.get(variable.env);
    if (first !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['variables', index, 'env'],
        message: `Variable « ${variable.env} » déjà définie`,
      });
      ctx.addIssue({
        code: 'custom',
        path: ['variables', first, 'env'],
        message: `Variable « ${variable.env} » déjà définie`,
      });
    } else {
      seen.set(variable.env, index);
    }
    if (variable.pattern) {
      try {
        new RegExp(variable.pattern);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['variables', index, 'pattern'],
          message: 'Regex invalide',
        });
      }
    }
  });

  // Update URL must be a valid URL when set
  if (value.updateUrl && !z.url().safeParse(value.updateUrl).success) {
    ctx.addIssue({ code: 'custom', path: ['updateUrl'], message: 'URL invalide' });
  }
}

export const recipeEditorSchema = z
  .object({
    id: z
      .string()
      .min(1, 'ID requis')
      .regex(/^[a-z0-9-]+$/, 'Minuscules, chiffres et tirets uniquement'),
    name: z.string().min(1, 'Nom requis'),
    author: z.string().min(1, 'Auteur requis'),
    description: z.string(),
    tags: z.array(z.string()),
    /** Windows container image the server runs in (carries java/steamcmd…). */
    dockerImage: z.string().min(1, 'Image Docker requise'),
    updateUrl: z.string(),
    requirements: requirementsValueSchema,
    env: z.array(kvPairSchema),
    backup: backupValueSchema,
    variables: z.array(recipeVariableValueSchema),
    install: z.array(actionValueSchema),
    start: z.object({
      command: z.string().min(1, 'Commande de démarrage requise'),
      stop: stopValueSchema.nullable(),
      ready: readyValueSchema.nullable(),
      workingDirectory: z.string(),
    }),
    logs: logsValueSchema,
  })
  .superRefine((value, ctx) => {
    refineEditorValue(value, ctx);

    // Duplicate keys in key/value lists
    const checkPairs = (pairs: KvPair[], path: (string | number)[]) => {
      const keys = new Set<string>();
      pairs.forEach((pair, i) => {
        if (!pair.key) return;
        if (keys.has(pair.key)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, i, 'key'],
            message: `Clé « ${pair.key} » en double`,
          });
        }
        keys.add(pair.key);
      });
    };
    checkPairs(value.env, ['env']);

    // Logs file required when following a file
    if (value.logs.mode === 'file' && !value.logs.file) {
      ctx.addIssue({ code: 'custom', path: ['logs', 'file'], message: 'Fichier de log requis' });
    }

    // Backup include patterns (contract validation, empty = whole dir)
    value.backup.include.forEach((pattern, index) => {
      if (!pattern) return;
      const error = validateBackupIncludePattern(pattern);
      if (error) {
        ctx.addIssue({ code: 'custom', path: ['backup', 'include', index], message: error });
      }
    });
  });

export type RecipeEditorValue = z.infer<typeof recipeEditorSchema>;

// ─── Defaults (create) ────────────────────────────────────────────────────────

export function emptyRecipeEditorValue(): RecipeEditorValue {
  return {
    id: '',
    name: '',
    author: '',
    description: '',
    tags: [],
    dockerImage: '',
    updateUrl: '',
    requirements: { minRamMb: 0, minDiskMb: 0, minCpuPercent: 0, requiredCommands: [] },
    env: [],
    backup: { include: [] },
    variables: [],
    install: [],
    start: {
      command: '',
      stop: null,
      ready: null,
      workingDirectory: '',
    },
    logs: { mode: 'stdout', file: '', stripAnsi: false },
  };
}

// ─── Hydration (edit) ─────────────────────────────────────────────────────────

function toPairs(record: Record<string, string> | undefined): KvPair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

/** Contract variables → editor variables (defaults applied). */
function contractVariablesToEditor(variables: Recipe['variables']): RecipeVariableValue[] {
  return variables.map((variable) => ({
    name: variable.name,
    env: variable.env,
    description: variable.description ?? '',
    type: variable.type,
    defaultValue: variable.default_value,
    userViewable: variable.user_viewable,
    userEditable: variable.user_editable,
    sort: variable.sort,
    required: variable.required,
    min: variable.min ?? 0,
    max: variable.max ?? 0,
    pattern: variable.pattern ?? '',
    options: variable.options ?? [],
  }));
}

/** Contract install steps → editor actions (flat union shape). */
function contractActionsToEditor(install: RunnerAction[]): ActionValue[] {
  return install.map((action): ActionValue => {
    const base = newActionValue(action.action);
    switch (action.action) {
      case 'download':
        return {
          ...base,
          action: 'download',
          url: action.url,
          dest: action.dest,
          checksum: action.checksum ?? '',
          headers: toPairs(action.headers),
        };
      case 'extract':
        return {
          ...base,
          action: 'extract',
          archive: action.archive,
          dest: action.dest,
          stripComponents: action.strip_components ?? 0,
        };
      case 'write':
        return { ...base, action: 'write', file: action.file, content: action.content };
      case 'replace':
        return {
          ...base,
          action: 'replace',
          file: action.file,
          find: action.find,
          replace: action.replace,
          regex: action.regex,
        };
      case 'configFile':
        return {
          ...base,
          action: 'configFile',
          file: action.file,
          parser: action.parser,
          configFind: toPairs(action.find),
        };
      case 'command':
        return {
          ...base,
          action: 'command',
          command: action.command,
          cwd: action.cwd ?? '',
          env: toPairs(action.env),
          timeoutMs: action.timeout_ms ?? 0,
          successCodes: (action.success_codes ?? []).map((code) => String(code)),
          tail: action.tail
            ? {
                file: action.tail.file,
                filter: action.tail.filter ?? '',
                intervalMs: action.tail.interval_ms ?? 0,
              }
            : null,
        };
      case 'script':
        return {
          ...base,
          action: 'script',
          shell: action.shell,
          content: action.content,
          timeoutMs: action.timeout_ms ?? 0,
        };
    }
  });
}

/** Contract requirements → editor requirements (0 = absent). */
function contractRequirementsToEditor(requirements: Recipe['requirements']): RequirementsValue {
  return {
    minRamMb: requirements?.min_ram_mb ?? 0,
    minDiskMb: requirements?.min_disk_mb ?? 0,
    minCpuPercent: requirements?.min_cpu_percent ?? 0,
    requiredCommands: requirements?.required_commands ?? [],
  };
}

/** Parsed recipe (contract output — defaults applied) → editor value. */
export function recipeToEditorValue(recipe: Recipe): RecipeEditorValue {
  return {
    id: recipe.id,
    name: recipe.name,
    author: recipe.author,
    description: recipe.description ?? '',
    tags: recipe.tags ?? [],
    dockerImage: recipe.docker_image,
    updateUrl: recipe.update_url ?? '',
    requirements: contractRequirementsToEditor(recipe.requirements),
    env: toPairs(recipe.env),
    backup: { include: recipe.backup?.include ?? [] },
    variables: contractVariablesToEditor(recipe.variables),
    install: contractActionsToEditor(recipe.install),
    start: {
      command: recipe.start.command,
      stop: recipe.start.stop
        ? {
            type: recipe.start.stop.type,
            value: recipe.start.stop.value,
            timeoutMs: recipe.start.stop.timeout_ms,
          }
        : null,
      ready: recipe.start.ready
        ? { pattern: recipe.start.ready.pattern, strip: recipe.start.ready.strip ?? '' }
        : null,
      workingDirectory: recipe.start.working_directory ?? '',
    },
    logs: {
      mode: recipe.logs?.mode ?? 'stdout',
      file: recipe.logs?.file ?? '',
      stripAnsi: recipe.logs?.strip_ansi ?? false,
    },
  };
}

// ─── Conversion (submit) ──────────────────────────────────────────────────────

function pairsToRecord(pairs: KvPair[]): Record<string, string> | undefined {
  const filtered = pairs.filter((pair) => pair.key !== '');
  if (filtered.length === 0) return undefined;
  return Object.fromEntries(filtered.map((pair) => [pair.key, pair.value]));
}

/** Editor variables → contract variables (empties stripped, sorted). */
function editorVariablesToContract(variables: RecipeVariableValue[]) {
  return variables
    .map((variable) => ({
      env: variable.env,
      name: variable.name,
      description: variable.description || undefined,
      type: variable.type,
      default_value: variable.defaultValue,
      user_viewable: variable.userViewable,
      user_editable: variable.userEditable,
      sort: variable.sort,
      required: variable.required,
      min: variable.type === 'number' && variable.min !== 0 ? variable.min : undefined,
      max: variable.type === 'number' && variable.max !== 0 ? variable.max : undefined,
      pattern: variable.pattern || undefined,
      options: variable.options.length > 0 ? variable.options : undefined,
    }))
    .sort((a, b) => a.sort - b.sort);
}

/** Editor actions → contract install steps (per-action shape). */
function editorActionsToContract(actions: ActionValue[]): RunnerActionInput[] {
  return actions.map((action): RunnerActionInput => {
    switch (action.action) {
      case 'download':
        return {
          action: 'download',
          url: action.url,
          dest: action.dest,
          checksum: action.checksum || undefined,
          headers: pairsToRecord(action.headers),
        };
      case 'extract':
        return {
          action: 'extract',
          archive: action.archive,
          dest: action.dest,
          strip_components: action.stripComponents || undefined,
        };
      case 'write':
        return { action: 'write', file: action.file, content: action.content };
      case 'replace':
        return {
          action: 'replace',
          file: action.file,
          find: action.find,
          replace: action.replace,
          regex: action.regex,
        };
      case 'configFile':
        return {
          action: 'configFile',
          file: action.file,
          parser: action.parser,
          find: pairsToRecord(action.configFind) ?? {},
        };
      case 'command':
        return {
          action: 'command',
          command: action.command,
          cwd: action.cwd || undefined,
          env: pairsToRecord(action.env),
          timeout_ms: action.timeoutMs || undefined,
          success_codes:
            action.successCodes.length > 0
              ? action.successCodes.map((code) => Number(code)).filter((n) => !Number.isNaN(n))
              : undefined,
          tail: action.tail
            ? {
                file: action.tail.file,
                filter: action.tail.filter || undefined,
                interval_ms: action.tail.intervalMs || undefined,
              }
            : undefined,
        };
      case 'script':
        return {
          action: 'script',
          shell: action.shell,
          content: action.content,
          timeout_ms: action.timeoutMs || undefined,
        };
    }
  });
}

/** Editor requirements → contract requirements (0/empty = absent). */
function editorRequirementsToContract(requirements: RequirementsValue) {
  return requirements.minRamMb ||
    requirements.minDiskMb ||
    requirements.minCpuPercent ||
    requirements.requiredCommands.length > 0
    ? {
        min_ram_mb: requirements.minRamMb || undefined,
        min_disk_mb: requirements.minDiskMb || undefined,
        min_cpu_percent: requirements.minCpuPercent || undefined,
        required_commands:
          requirements.requiredCommands.length > 0 ? requirements.requiredCommands : undefined,
      }
    : undefined;
}

/**
 * Editor value → recipe JSON (contract input shape, empties stripped).
 * Returns `{ recipe }` on success, or `{ issues }` when the contract
 * schema rejects the value (final validation before send).
 */
export function recipeEditorValueToRecipe(value: RecipeEditorValue): {
  recipe?: Recipe;
  issues?: string[];
} {
  const recipe = {
    schema_version: 3,
    id: value.id,
    name: value.name,
    author: value.author,
    description: value.description || undefined,
    tags: value.tags,
    docker_image: value.dockerImage,
    update_url: value.updateUrl || undefined,
    requirements: editorRequirementsToContract(value.requirements),
    env: pairsToRecord(value.env),
    backup: (() => {
      const include = value.backup.include.map((p) => p.trim()).filter(Boolean);
      return include.length > 0 ? { include } : undefined;
    })(),
    variables: editorVariablesToContract(value.variables),
    install: editorActionsToContract(value.install),
    start: {
      command: value.start.command,
      stop: value.start.stop
        ? {
            type: value.start.stop.type,
            value: value.start.stop.value,
            timeout_ms: value.start.stop.timeoutMs || 30000,
          }
        : undefined,
      ready: value.start.ready
        ? {
            pattern: value.start.ready.pattern,
            strip: value.start.ready.strip || undefined,
          }
        : undefined,
      working_directory: value.start.workingDirectory || undefined,
    },
    logs: {
      mode: value.logs.mode,
      file: value.logs.mode === 'file' ? value.logs.file : undefined,
      strip_ansi: value.logs.stripAnsi,
    },
  };

  const parsed = safeParseRecipe(recipe);
  if (parsed.success) {
    return { recipe: parsed.data };
  }
  return {
    issues: parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || 'recipe'} : ${issue.message}`,
    ),
  };
}

/**
 * List of `{{VAR}}` template variables used but not declared
 * (recipe variables, system variables, or fixed env). Live helper
 * for the editor's warning banner — mirrors the install-time check.
 */
export function findUnknownVariablesInEditorValue(value: RecipeEditorValue): string[] {
  const fixedEnv = new Set(value.env.filter((pair) => pair.key).map((pair) => pair.key));
  const declared = new Set<string>([
    ...value.variables.filter((v) => v.env).map((v) => v.env),
    ...RESERVED_ENV_NAMES,
    ...fixedEnv,
  ]);
  const used = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(/\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g)) {
      used.add(match[1]);
    }
  };

  collect(value.start.command);
  if (value.start.workingDirectory) collect(value.start.workingDirectory);
  if (value.start.ready) collect(value.start.ready.pattern);
  if (value.start.stop) collect(value.start.stop.value);
  if (value.logs.file) collect(value.logs.file);

  for (const action of value.install) {
    collect(action.url);
    collect(action.dest);
    collect(action.archive);
    collect(action.file);
    collect(action.content);
    collect(action.find);
    collect(action.replace);
    collect(action.command);
    collect(action.cwd);
    for (const pair of action.configFind) collect(pair.value);
    if (action.tail) collect(action.tail.file);
  }

  return [...used].filter((name) => !declared.has(name));
}
