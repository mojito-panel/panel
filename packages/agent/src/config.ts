import { z } from 'zod';

/**
 * Configuration de l'agent, chargée depuis les variables d'environnement
 * ou un fichier config.json (V1 : env vars prioritaires).
 */
export const agentConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8080),
  host: z.string().default('0.0.0.0'),
  token: z.string().min(32, 'Le token agent doit faire au moins 32 caractères'),
  panelUrl: z.string().url().optional(),
  dataDir: z.string().default('C:\PanelData'),
  version: z.string().default('0.1.0'),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * Charge la config depuis process.env.
 * Lance si le token est manquant.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return agentConfigSchema.parse({
    port: env.AGENT_PORT,
    host: env.AGENT_HOST,
    token: env.AGENT_TOKEN,
    panelUrl: env.PANEL_URL,
    dataDir: env.AGENT_DATA_DIR,
    version: env.AGENT_VERSION,
  });
}
