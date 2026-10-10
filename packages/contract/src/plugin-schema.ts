import { z } from 'zod';

/**
 * Schéma Zod du plugin JSON (egg) — contrat partagé panel ↔ agent.
 * Définit la structure d'un plugin de serveur de jeu (Minecraft, Source, etc.)
 */

// ─── Variables ────────────────────────────────────────────────────────────────

export const variableTypeSchema = z.enum(['string', 'number', 'boolean']);

export const pluginVariableSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Identifiant de variable invalide'),
  type: variableTypeSchema,
  default: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string().min(1),
  description: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
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
  checksum: z.string().optional(),
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
});

const commandActionSchema = z.object({
  action: z.literal('command'),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const runnerActionSchema = z.discriminatedUnion('action', [
  downloadActionSchema,
  extractActionSchema,
  writeActionSchema,
  replaceActionSchema,
  commandActionSchema,
]);

export type RunnerAction = z.infer<typeof runnerActionSchema>;

// ─── Stop gracieux ────────────────────────────────────────────────────────────

export const stopConfigSchema = z.object({
  type: z.enum(['command', 'signal']),
  value: z.string().min(1),
  timeoutMs: z.number().int().positive().default(30000),
});

export type StopConfig = z.infer<typeof stopConfigSchema>;

// ─── Start ────────────────────────────────────────────────────────────────────

export const startConfigSchema = z.object({
  command: z.string().min(1),
  stop: stopConfigSchema.optional(),
  readyPattern: z.string().optional(),
  workingDirectory: z.string().optional(),
});

export type StartConfig = z.infer<typeof startConfigSchema>;

// ─── Plugin complet ───────────────────────────────────────────────────────────

export const pluginSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'ID invalide (minuscules, chiffres, tirets)'),
  name: z.string().min(1),
  author: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  requirements: pluginRequirementsSchema.optional(),
  variables: z.array(pluginVariableSchema).default([]),
  install: z.array(runnerActionSchema).default([]),
  start: startConfigSchema,
  env: z.record(z.string(), z.string()).optional(),
});

export type Plugin = z.infer<typeof pluginSchema>;

// ─── Helpers de validation ────────────────────────────────────────────────────

/**
 * Valide un objet JSON brut comme plugin.
 * Lance une ZodError si invalide.
 */
export function parsePlugin(data: unknown): Plugin {
  return pluginSchema.parse(data);
}

/**
 * Valide un plugin et retourne le résultat sans lancer d'exception.
 */
export function safeParsePlugin(data: unknown) {
  return pluginSchema.safeParse(data);
}

/**
 * Extrait les IDs de variables référencées dans un template `{{var}}`.
 */
export function extractTemplateVars(template: string): string[] {
  const matches = template.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/**
 * Vérifie que toutes les variables utilisées dans les templates du plugin
 * sont déclarées dans `variables`. Retourne la liste des variables inconnues.
 */
export function findUnknownVariables(plugin: Plugin): string[] {
  const declared = new Set(plugin.variables.map((v) => v.id));
  const used = new Set<string>();

  const collectFrom = (text: string) => {
    for (const v of extractTemplateVars(text)) used.add(v);
  };

  collectFrom(plugin.start.command);
  if (plugin.start.readyPattern) collectFrom(plugin.start.readyPattern);
  if (plugin.start.stop) collectFrom(plugin.start.stop.value);

  for (const action of plugin.install) {
    if (action.action === 'download') collectFrom(action.url);
    if (action.action === 'write') collectFrom(action.content);
    if (action.action === 'replace') {
      collectFrom(action.find);
      collectFrom(action.replace);
    }
    if (action.action === 'command') collectFrom(action.command);
  }

  if (plugin.env) {
    for (const val of Object.values(plugin.env)) collectFrom(val);
  }

  return [...used].filter((v) => !declared.has(v));
}
