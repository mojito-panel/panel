import { z } from 'zod';

/**
 * Contrat API panel ↔ agent.
 * Définit les routes HTTP et les payloads WebSocket échangés entre le panel et l'agent.
 */

// ─── Healthcheck ──────────────────────────────────────────────────────────────

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

// ─── Server lifecycle (panel → agent) ─────────────────────────────────────────

/** Allocation du serveur — source des variables système (SERVER_PORT, SERVER_MEMORY...). */
export const serverAllocationSchema = z.object({
  port: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
  ip: z.string().default('0.0.0.0'),
});

export type ServerAllocationPayload = z.infer<typeof serverAllocationSchema>;

export const installServerRequestSchema = z.object({
  serverId: z.string().uuid(),
  name: z.string().min(1),
  plugin: z.unknown(), // Plugin validé côté panel, transmis tel quel
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  installDir: z.string().min(1),
  allocation: serverAllocationSchema,
});

export type InstallServerRequest = z.infer<typeof installServerRequestSchema>;

export const serverActionSchema = z.enum(['start', 'stop', 'restart', 'kill']);

export type ServerAction = z.infer<typeof serverActionSchema>;

export const serverActionRequestSchema = z.object({
  serverId: z.string().uuid(),
  action: serverActionSchema,
});

export type ServerActionRequest = z.infer<typeof serverActionRequestSchema>;

export const sendCommandRequestSchema = z.object({
  serverId: z.string().uuid(),
  command: z.string().min(1),
});

export type SendCommandRequest = z.infer<typeof sendCommandRequestSchema>;

// ─── Server status ────────────────────────────────────────────────────────────

export const serverStatusSchema = z.enum([
  'installing',
  'stopped',
  'running',
  'crashed',
]);

export type ServerStatus = z.infer<typeof serverStatusSchema>;

export const serverInfoSchema = z.object({
  serverId: z.string().uuid(),
  status: serverStatusSchema,
  pid: z.number().int().positive().nullable(),
  ramMb: z.number().nonnegative().nullable(),
  cpuPercent: z.number().nonnegative().nullable(),
  startedAt: z.string().datetime().nullable(),
});

export type ServerInfo = z.infer<typeof serverInfoSchema>;

// ─── Progression d'installation (agent → panel, via WS) ───────────────────────

export const installProgressSchema = z.object({
  serverId: z.string().uuid(),
  step: z.number().int().min(0),
  totalSteps: z.number().int().min(0),
  message: z.string(),
  percent: z.number().min(0).max(100),
});

export type InstallProgress = z.infer<typeof installProgressSchema>;

// ─── Logs live (agent → panel, via WS) ────────────────────────────────────────

export const logLineSchema = z.object({
  serverId: z.string().uuid(),
  timestamp: z.string().datetime(),
  stream: z.enum(['stdout', 'stderr']),
  line: z.string(),
});

export type LogLine = z.infer<typeof logLineSchema>;

// ─── Messages WebSocket (union discriminée) ───────────────────────────────────

export const wsMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('install-progress'), payload: installProgressSchema }),
  z.object({ type: z.literal('log'), payload: logLineSchema }),
  z.object({ type: z.literal('status'), payload: serverInfoSchema }),
  z.object({ type: z.literal('pong') }),
]);

export type WsMessage = z.infer<typeof wsMessageSchema>;

// ─── Routes HTTP (référence) ──────────────────────────────────────────────────

/**
 * Routes exposées par l'agent. Toutes protégées par `Authorization: Bearer <token>`.
 */
export const AGENT_ROUTES = {
  health: 'GET /health',
  install: 'POST /servers/install',
  action: 'POST /servers/:serverId/action',
  command: 'POST /servers/:serverId/command',
  info: 'GET /servers/:serverId',
  list: 'GET /servers',
} as const;
