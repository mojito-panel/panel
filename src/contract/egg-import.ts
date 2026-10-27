import { z } from 'zod';
import {
  recipeSchema,
  recipeVariableSchema,
  type Recipe,
  type RecipeVariable,
} from './recipe-schema';

/**
 * PTDL_v2 (Pelican egg) import — maps an egg JSON to a recipe v4.
 *
 * Eggs are Linux/bash/docker artifacts: only the declarative parts map 1:1
 * (variables, startup/stop/ready, config.files). The install scripts are
 * IGNORED — they run bash against a Linux image — and the docker images
 * are IGNORED too — the agent runs native Windows processes, the recipe
 * provisions its own runtimes — so the import always returns warnings:
 * the install section must be rewritten with the declarative actions
 * (download/extract/write/replace/configFile/command).
 */

// ─── Egg schemas (subset of PTDL_v2 that we map) ────────────────────────────

const eggVariableSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  env: z.string().min(1),
  default_value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  user_viewable: z.boolean().optional(),
  user_editable: z.boolean().optional(),
  /** Laravel-style rules: "required|string|max:20", "in:val1,val2", "regex:/.../". */
  rules: z.string().optional(),
  /** Panel field type (text/bool/pobox) — informational only. */
  field_type: z.string().optional(),
  sort: z.union([z.string(), z.number()]).optional(),
});

const eggFileFindSchema = z.object({
  path: z.string().min(1),
  text: z.string().optional(),
});

const eggFileSchema = z.object({
  file: z.string().min(1),
  parser: z.string().optional(),
  find: z.array(eggFileFindSchema).optional(),
});

const eggConfigSchema = z.object({
  files: z.record(z.string(), eggFileSchema).optional(),
  startup: z
    .object({
      /** Regex indicating the server is ready (recipe `ready.pattern`). */
      done: z.string().optional(),
      /** Regex stripped from log lines before matching the done pattern. */
      stripFrom: z.string().optional(),
    })
    .optional(),
  logs: z
    .object({
      custom: z.boolean().optional(),
      /** File followed when custom (recipe `logs.mode = file`). */
      location: z.string().optional(),
    })
    .optional(),
});

const eggSchema = z.object({
  name: z.string().min(1),
  author: z.string().min(1).optional(),
  description: z.string().optional(),
  /** "PTDL_v2" — anything else (PTDL_v1) is rejected. */
  meta: z.object({ version: z.string() }).optional(),
  features: z.array(z.string()).optional(),
  /** Map of image → label; the FIRST entry is used as the recipe image. */
  docker_images: z.record(z.string(), z.string()).optional(),
  docker_image: z.record(z.string(), z.string()).optional(),
  update_url: z.string().optional(),
  startup: z.string().optional(),
  stop: z.string().optional(),
  config: eggConfigSchema.optional(),
  variables: z.array(eggVariableSchema).optional(),
});

type EggVariable = z.infer<typeof eggVariableSchema>;
type Egg = z.infer<typeof eggSchema>;

// ─── Variable mapping (EggVariable → recipeVariableSchema, 1:1) ─────────────

/** Slug for the recipe id — eggs carry no id of their own. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'oeuf-importe'
  );
}

/**
 * Parses Laravel-style validation rules into the recipe variable fields
 * (min/max/pattern/options) — only what the recipe variable schema models
 * is extracted, the rest is ignored (the value is still validated by the
 * panel at variable-edit time).
 */
function parseRules(
  rules: string,
): Pick<RecipeVariable, 'type' | 'min' | 'max' | 'pattern' | 'options' | 'required'> {
  const out: Pick<RecipeVariable, 'type' | 'min' | 'max' | 'pattern' | 'options' | 'required'> = {
    type: 'string',
    required: false,
  };
  for (const rule of rules.split('|')) {
    const trimmed = rule.trim();
    if (trimmed === 'required') out.required = true;
    else if (trimmed === 'boolean') out.type = 'boolean';
    else if (trimmed === 'integer' || trimmed === 'numeric' || trimmed === 'digits')
      out.type = 'number';
    else if (trimmed.startsWith('min:')) {
      const value = Number(trimmed.slice(4));
      if (!Number.isNaN(value)) {
        if (out.type === 'number') out.min = value;
        else out.min = value; // string length — kept as-is, best effort
      }
    } else if (trimmed.startsWith('max:')) {
      const value = Number(trimmed.slice(4));
      if (!Number.isNaN(value)) out.max = value;
    } else if (trimmed.startsWith('between:')) {
      const [min, max] = trimmed.slice(8).split(',').map(Number);
      if (!Number.isNaN(min)) out.min = min;
      if (!Number.isNaN(max)) out.max = max;
    } else if (trimmed.startsWith('regex:')) {
      // "regex:/pattern/" — the regex is the first slash-delimited segment.
      const source = trimmed.slice(6);
      const body = source.startsWith('/') ? source.replace(/^\/(.+?)\/[a-z]*$/, '$1') : source;
      if (body) out.pattern = body;
    } else if (trimmed.startsWith('in:')) {
      out.options = trimmed
        .slice(3)
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    }
  }
  return out;
}

function mapVariable(variable: EggVariable, sort: number): RecipeVariable {
  const parsed = recipeVariableSchema.parse({
    env: variable.env.trim().toUpperCase(),
    name: variable.name,
    description: variable.description || undefined,
    ...parseRules(variable.rules ?? ''),
    default_value:
      variable.default_value !== undefined && variable.default_value !== null
        ? variable.default_value
        : '',
    user_viewable: variable.user_viewable ?? true,
    user_editable: variable.user_editable ?? true,
    sort: Number(variable.sort ?? sort) || sort,
  });
  return parsed;
}

// ─── config.files → configFile actions ───────────────────────────────────────

/** Egg parser names → the recipe's parser enum; null = unsupported. */
const EGG_PARSERS: Record<string, 'properties' | 'ini' | 'yaml' | 'json'> = {
  properties: 'properties',
  propertiesfile: 'properties',
  ini: 'ini',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
};

// ─── Public import ───────────────────────────────────────────────────────────

/**
 * Maps a PTDL_v2 egg JSON to a recipe v4. Throws a ZodError when the egg
 * itself is unreadable; returns `{ recipe, warnings }` where `warnings`
 * lists everything that could NOT be mapped (user-facing, French).
 */
export function importEgg(raw: unknown): { recipe: Recipe; warnings: string[] } {
  const egg = eggSchema.parse(raw);
  const warnings: string[] = [];

  if (egg.meta?.version && egg.meta.version !== 'PTDL_v2') {
    throw new z.ZodError([
      {
        code: 'custom',
        path: ['meta', 'version'],
        message: `Version d'œuf non supportée : ${egg.meta.version} (PTDL_v2 attendu)`,
        input: egg.meta.version,
      },
    ]);
  }

  // Docker images: the native process model has no image — the declared
  // images are informational, the runtimes come from the recipe's own
  // download/extract actions (a warning tells the admin to provision them).
  const imageMap = egg.docker_images ?? egg.docker_image ?? {};
  if (Object.keys(imageMap).length === 0) {
    warnings.push(
      "L'œuf ne déclare aucune image Docker (le modèle natif n'en a pas besoin — les runtimes se provisionnent par les actions de la recette).",
    );
  } else {
    warnings.push(
      `Images Docker de l'œuf ignorées (${Object.values(imageMap).join(', ')}) — le modèle natif provisionne ses runtimes par les actions de la recette.`,
    );
  }

  // Variables — EggVariable maps 1:1 to the recipe variable schema.
  const variables = (egg.variables ?? []).map((variable, index) =>
    mapVariable(variable, index),
  );

  // config.files → configFile actions (unsupported parsers are skipped).
  const install: z.input<typeof recipeSchema>['install'] = [];
  for (const [key, file] of Object.entries(egg.config?.files ?? {})) {
    const parser = file.parser ? EGG_PARSERS[file.parser.toLowerCase()] : undefined;
    const findEntries = (file.find ?? []).filter((entry) => entry.text !== undefined);
    if (!parser) {
      warnings.push(
        `Fichier de config « ${key} » ignoré : parseur non supporté (${file.parser ?? 'absent'}).`,
      );
      continue;
    }
    if (findEntries.length === 0) {
      warnings.push(`Fichier de config « ${key} » ignoré : aucune clé à modifier.`);
      continue;
    }
    const find: Record<string, string> = {};
    for (const entry of findEntries) find[entry.path] = entry.text ?? '';
    install.push({ action: 'configFile', file: file.file, parser, find });
  }

  // Startup / stop / ready.
  const startup = egg.startup ?? '';
  if (!startup) warnings.push("L'œuf ne déclare pas de commande de démarrage — à compléter.");
  const stopCommand = egg.stop;
  const done = egg.config?.startup?.done;
  const stripFrom = egg.config?.startup?.stripFrom;

  // Logs: a custom location maps to the file-follow mode.
  const logsConfig = egg.config?.logs?.custom ? egg.config?.logs?.location : undefined;

  const recipe = recipeSchema.parse({
    schema_version: 4,
    id: slugify(egg.name),
    name: egg.name,
    author: egg.author || 'import',
    description: egg.description || undefined,
    update_url: egg.update_url || undefined,
    variables,
    install,
    start: {
      command: startup,
      stop: stopCommand
        ? { type: 'command', value: stopCommand, timeout_ms: 30000 }
        : undefined,
      ready: done ? { pattern: done, strip: stripFrom || undefined } : undefined,
    },
    logs: logsConfig ? { mode: 'file', file: logsConfig, strip_ansi: true } : undefined,
  });

  // Install scripts never map — the install section is ALWAYS rewritten.
  warnings.push(
    "Les scripts d'installation de l'œuf sont ignorés : réécris la section Installation avec les actions déclaratives (téléchargement, extraction, écriture, commande…).",
  );
  if (egg.features && egg.features.length > 0) {
    warnings.push(`Fonctionnalités non prises en charge (ignorées) : ${egg.features.join(', ')}.`);
  }

  return { recipe, warnings };
}
