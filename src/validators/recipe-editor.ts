import { z } from 'zod';
import {
  RESERVED_ENV_NAMES,
  STOP_SIGNALS,
  findToolFeatureErrors,
  safeParseRecipe,
  validateBackupIncludePattern,
  type Recipe,
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
    shell: z.enum(['bash', 'powershell', 'cmd']),
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
    features: z.array(z.string()),
    updateUrl: z.string(),
    requirements: requirementsValueSchema,
    runtime: z.array(kvPairSchema),
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
    checkPairs(value.runtime, ['runtime']);
    checkPairs(value.env, ['env']);

    // Logs file required when following a file
    if (value.logs.mode === 'file' && !value.logs.file) {
      ctx.addIssue({ code: 'custom', path: ['logs', 'file'], message: 'Fichier de log requis' });
    }

    // Update URL must be a valid URL when set
    if (value.updateUrl && !z.url().safeParse(value.updateUrl).success) {
      ctx.addIssue({ code: 'custom', path: ['updateUrl'], message: 'URL invalide' });
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
    features: [],
    updateUrl: '',
    requirements: { minRamMb: 0, minDiskMb: 0, minCpuPercent: 0, requiredCommands: [] },
    runtime: [],
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

/** Parsed recipe (contract output — defaults applied) → editor value. */
export function recipeToEditorValue(recipe: Recipe): RecipeEditorValue {
  return {
    id: recipe.id,
    name: recipe.name,
    author: recipe.author,
    description: recipe.description ?? '',
    tags: recipe.tags ?? [],
    features: recipe.features ?? [],
    updateUrl: recipe.updateUrl ?? '',
    requirements: {
      minRamMb: recipe.requirements?.minRamMb ?? 0,
      minDiskMb: recipe.requirements?.minDiskMb ?? 0,
      minCpuPercent: recipe.requirements?.minCpuPercent ?? 0,
      requiredCommands: recipe.requirements?.requiredCommands ?? [],
    },
    runtime: toPairs(recipe.runtime),
    env: toPairs(recipe.env),
    backup: { include: recipe.backup?.include ?? [] },
    variables: recipe.variables.map((variable) => ({
      name: variable.name,
      env: variable.env,
      description: variable.description ?? '',
      type: variable.type,
      defaultValue: variable.defaultValue,
      userViewable: variable.userViewable,
      userEditable: variable.userEditable,
      sort: variable.sort,
      required: variable.required,
      min: variable.min ?? 0,
      max: variable.max ?? 0,
      pattern: variable.pattern ?? '',
      options: variable.options ?? [],
    })),
    install: recipe.install.map((action): ActionValue => {
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
            stripComponents: action.stripComponents ?? 0,
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
            timeoutMs: action.timeoutMs ?? 0,
            successCodes: (action.successCodes ?? []).map((code) => String(code)),
            tail: action.tail
              ? {
                  file: action.tail.file,
                  filter: action.tail.filter ?? '',
                  intervalMs: action.tail.intervalMs ?? 0,
                }
              : null,
          };
        case 'script':
          return {
            ...base,
            action: 'script',
            shell: action.shell,
            content: action.content,
            timeoutMs: action.timeoutMs ?? 0,
          };
      }
    }),
    start: {
      command: recipe.start.command,
      stop: recipe.start.stop
        ? {
            type: recipe.start.stop.type,
            value: recipe.start.stop.value,
            timeoutMs: recipe.start.stop.timeoutMs,
          }
        : null,
      ready: recipe.start.ready
        ? { pattern: recipe.start.ready.pattern, strip: recipe.start.ready.strip ?? '' }
        : null,
      workingDirectory: recipe.start.workingDirectory ?? '',
    },
    logs: {
      mode: recipe.logs?.mode ?? 'stdout',
      file: recipe.logs?.file ?? '',
      stripAnsi: recipe.logs?.stripAnsi ?? false,
    },
  };
}

// ─── Conversion (submit) ──────────────────────────────────────────────────────

function pairsToRecord(pairs: KvPair[]): Record<string, string> | undefined {
  const filtered = pairs.filter((pair) => pair.key !== '');
  if (filtered.length === 0) return undefined;
  return Object.fromEntries(filtered.map((pair) => [pair.key, pair.value]));
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
  const variables = value.variables
    .map((variable) => ({
      env: variable.env,
      name: variable.name,
      description: variable.description || undefined,
      type: variable.type,
      defaultValue: variable.defaultValue,
      userViewable: variable.userViewable,
      userEditable: variable.userEditable,
      sort: variable.sort,
      required: variable.required,
      min: variable.type === 'number' && variable.min !== 0 ? variable.min : undefined,
      max: variable.type === 'number' && variable.max !== 0 ? variable.max : undefined,
      pattern: variable.pattern || undefined,
      options: variable.options.length > 0 ? variable.options : undefined,
    }))
    .sort((a, b) => a.sort - b.sort);

  const install = value.install.map((action): RunnerActionInput => {
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
          stripComponents: action.stripComponents || undefined,
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
          timeoutMs: action.timeoutMs || undefined,
          successCodes:
            action.successCodes.length > 0
              ? action.successCodes.map((code) => Number(code)).filter((n) => !Number.isNaN(n))
              : undefined,
          tail: action.tail
            ? {
                file: action.tail.file,
                filter: action.tail.filter || undefined,
                intervalMs: action.tail.intervalMs || undefined,
              }
            : undefined,
        };
      case 'script':
        return {
          action: 'script',
          shell: action.shell,
          content: action.content,
          timeoutMs: action.timeoutMs || undefined,
        };
    }
  });

  const recipe = {
    schemaVersion: 2,
    id: value.id,
    name: value.name,
    author: value.author,
    description: value.description || undefined,
    tags: value.tags,
    features: value.features,
    updateUrl: value.updateUrl || undefined,
    requirements:
      value.requirements.minRamMb ||
      value.requirements.minDiskMb ||
      value.requirements.minCpuPercent ||
      value.requirements.requiredCommands.length > 0
        ? {
            minRamMb: value.requirements.minRamMb || undefined,
            minDiskMb: value.requirements.minDiskMb || undefined,
            minCpuPercent: value.requirements.minCpuPercent || undefined,
            requiredCommands:
              value.requirements.requiredCommands.length > 0
                ? value.requirements.requiredCommands
                : undefined,
          }
        : undefined,
    runtime: pairsToRecord(value.runtime),
    env: pairsToRecord(value.env),
    backup: (() => {
      const include = value.backup.include.map((p) => p.trim()).filter(Boolean);
      return include.length > 0 ? { include } : undefined;
    })(),
    variables,
    install,
    start: {
      command: value.start.command,
      stop: value.start.stop
        ? {
            type: value.start.stop.type,
            value: value.start.stop.value,
            timeoutMs: value.start.stop.timeoutMs || 30000,
          }
        : undefined,
      ready: value.start.ready
        ? {
            pattern: value.start.ready.pattern,
            strip: value.start.ready.strip || undefined,
          }
        : undefined,
      workingDirectory: value.start.workingDirectory || undefined,
    },
    logs: {
      mode: value.logs.mode,
      file: value.logs.mode === 'file' ? value.logs.file : undefined,
      stripAnsi: value.logs.stripAnsi,
    },
  };

  const parsed = safeParseRecipe(recipe);
  if (parsed.success) {
    // Tool features (java, steamcmd) — same upfront check the agent runs at install
    const toolErrors = findToolFeatureErrors(parsed.data);
    if (toolErrors.length > 0) {
      return { issues: toolErrors };
    }
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
