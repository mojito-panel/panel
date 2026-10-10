import { z } from 'zod';
import { config } from 'dotenv';

config({ quiet: true });

/**
 * Agent configuration, loaded from environment variables
 * or a config.json file (V1: env vars take priority).
 */
export const agentConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(8080),
  host: z.string().default('0.0.0.0'),
  token: z.string().min(32, 'Le token agent doit faire au moins 32 caractères'),
  /** Extra origins allowed to open a console WS (the panel URL is always allowed). */
  allowedOrigins: z.array(z.string()).default([]),
  panelUrl: z.string().url().optional(),
  dataDir: z.string().default('C:\PanelData'),
  version: z.string().default('0.1.0'),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

/**
 * Loads the config from process.env.
 * Throws if the token is missing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return agentConfigSchema.parse({
    port: env.AGENT_PORT,
    host: env.AGENT_HOST,
    token: env.AGENT_TOKEN,
    panelUrl: env.PANEL_URL,
    allowedOrigins: (env.AGENT_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dataDir: env.AGENT_DATA_DIR,
    version: env.AGENT_VERSION,
  });
}
