import { z } from 'zod';

/**
 * Panel ↔ agent API contract.
 * Defines the HTTP routes and WebSocket payloads exchanged between panel and agent.
 */

// ─── Healthcheck ──────────────────────────────────────────────────────────────

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

// ─── Server lifecycle (panel → agent) ─────────────────────────────────────────

/** Server allocation — source of system variables (SERVER_PORT, SERVER_MEMORY...). */
export const serverAllocationSchema = z.object({
  port: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
  ip: z.string().default('0.0.0.0'),
});

export type ServerAllocationPayload = z.infer<typeof serverAllocationSchema>;

export const installServerRequestSchema = z.object({
  serverId: z.string().uuid(),
  name: z.string().min(1),
  plugin: z.unknown(), // Plugin validated on the panel side, passed as-is
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  installDir: z.string().min(1),
  allocation: serverAllocationSchema,
});

export type InstallServerRequest = z.infer<typeof installServerRequestSchema>;

/**
 * Reinstall — same semantics as Pelican: the agent stops the server (if
 * running), then re-runs the plugin's install script in place. The panel
 * sends the CURRENT plugin (an update may have changed the install script);
 * the agent keeps its stored installDir and allocation.
 */
export const reinstallServerRequestSchema = z.object({
  serverId: z.string().uuid(),
  plugin: z.unknown(), // Plugin validated by the agent, passed as-is
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type ReinstallServerRequest = z.infer<typeof reinstallServerRequestSchema>;

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

// ─── Install progress (agent → panel, via WS) ───────────────────────

export const installProgressSchema = z.object({
  serverId: z.string().uuid(),
  step: z.number().int().min(0),
  totalSteps: z.number().int().min(0),
  message: z.string(),
  percent: z.number().min(0).max(100),
});

export type InstallProgress = z.infer<typeof installProgressSchema>;

// ─── Install status & logs (panel → agent polling) ────────────────────────────

/**
 * Live status of a (re)install, with the full step log — each step's start
 * message, command/script output and errors. The agent keeps it in memory
 * for the last install of each server.
 */
export const installLogLineSchema = z.object({
  timestamp: z.string().datetime(),
  level: z.enum(['info', 'error']),
  message: z.string(),
});

export type InstallLogLine = z.infer<typeof installLogLineSchema>;

export const installStatusSchema = z.object({
  serverId: z.string().uuid(),
  status: z.enum(['installing', 'installed', 'failed']),
  step: z.number().int().min(0),
  totalSteps: z.number().int().min(0),
  percent: z.number().min(0).max(100),
  message: z.string(),
  error: z.string().nullable(),
  logs: z.array(installLogLineSchema),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export type InstallStatus = z.infer<typeof installStatusSchema>;

// ─── Live logs (agent → panel, via WS) ────────────────────────────────────────

export const logLineSchema = z.object({
  serverId: z.string().uuid(),
  timestamp: z.string().datetime(),
  stream: z.enum(['stdout', 'stderr']),
  line: z.string(),
});

export type LogLine = z.infer<typeof logLineSchema>;

// ─── WebSocket messages (discriminated union) ───────────────────────────────────

export const wsMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('install-progress'), payload: installProgressSchema }),
  z.object({ type: z.literal('log'), payload: logLineSchema }),
  z.object({ type: z.literal('status'), payload: serverInfoSchema }),
  z.object({ type: z.literal('pong') }),
]);

export type WsMessage = z.infer<typeof wsMessageSchema>;

// ─── Console permissions & JWT (browser ↔ agent, token issued by the panel) ───

/**
 * Closed permission list (Pelican-style subset). The agent gates EVERY incoming
 * console action on these — the panel decides who gets what, the agent enforces it.
 */
export const permissionSchema = z.enum([
  'console.read',
  'console.write',
  'power.start',
  'power.stop',
  'power.restart',
  'power.kill',
  'variables.read',
  'variables.write',
]);

export type Permission = z.infer<typeof permissionSchema>;

/**
 * V1: no invitations/sub-users — owners and admins get every permission.
 * The closed list above already exists so V2 can narrow it down.
 */
export const ALL_PERMISSIONS: readonly Permission[] = permissionSchema.options;

/** TTL of a console JWT, in seconds. Short on purpose: revocation = reconnect. */
export const CONSOLE_TOKEN_TTL_SECONDS = 300;

/**
 * Payload of the console JWT (HS256, signed by the panel with the node's agent
 * token, verified by the agent with its own token — Pelican-style single
 * per-node secret). `serverId` must match the WS route parameter; `permissions`
 * gate every message; `scope` ties the token to the websocket flow only.
 */
export const consoleTokenPayloadSchema = z.object({
  iss: z.literal('mojito-panel'),
  aud: z.literal('mojito-agent'),
  sub: z.string().min(1), // user id
  serverId: z.string().uuid(),
  permissions: z.array(permissionSchema),
  scope: z.literal('websocket'),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jti: z.string().min(1),
});

export type ConsoleTokenPayload = z.infer<typeof consoleTokenPayloadSchema>;

/** Panel → browser response for "give me a console token". */
export const consoleTokenResponseSchema = z.object({
  token: z.string().min(1),
  wsUrl: z.string().min(1),
});

export type ConsoleTokenResponse = z.infer<typeof consoleTokenResponseSchema>;

// ─── Console WebSocket messages (browser ↔ agent) ─────────────────────────────

/**
 * Browser → agent. Pelican-style handshake: the socket opens UNauthenticated
 * and the JWT travels as the first `auth` message — never in the URL/query
 * string. Re-sending `auth` refreshes the token without reconnecting.
 */
export const consoleClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    token: z.string().min(1).max(4096),
  }),
  z.object({
    type: z.literal('command'),
    command: z.string().min(1).max(1000),
  }),
  z.object({
    type: z.literal('power'),
    action: serverActionSchema,
  }),
]);

export type ConsoleClientMessage = z.infer<typeof consoleClientMessageSchema>;

export const consoleErrorSchema = z.enum([
  'unauthorized',
  'forbidden',
  'invalid-message',
  'rate-limited',
]);

export type ConsoleError = z.infer<typeof consoleErrorSchema>;

/** Agent → browser. */
export const consoleServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth-ok') }),
  z.object({ type: z.literal('log'), lines: z.array(z.string()) }),
  z.object({ type: z.literal('status'), status: serverStatusSchema }),
  z.object({ type: z.literal('error'), code: consoleErrorSchema }),
]);

export type ConsoleServerMessage = z.infer<typeof consoleServerMessageSchema>;

// ─── HTTP routes (reference) ──────────────────────────────────────────────────

/**
 * Routes exposed by the agent. All protected by `Authorization: Bearer <token>`.
 */
export const AGENT_ROUTES = {
  health: 'GET /health',
  install: 'POST /servers/install',
  reinstall: 'POST /servers/:serverId/reinstall',
  action: 'POST /servers/:serverId/action',
  command: 'POST /servers/:serverId/command',
  info: 'GET /servers/:serverId',
  installStatus: 'GET /servers/:serverId/install',
  list: 'GET /servers',
  delete: 'DELETE /servers/:serverId',
  /** Browser-facing console socket — auth by console JWT (?token=), NOT the panel token. */
  consoleWs: 'GET /servers/:serverId/ws',
} as const;
