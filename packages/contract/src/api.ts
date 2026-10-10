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
  /** step = step start/end (yellow in the panel), info = command output (gray), error = stderr/failure. */
  level: z.enum(['info', 'step', 'error']),
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
  z.object({
    /** Live install/reinstall status — replaces the panel's install polling. */
    type: z.literal('install-status'),
    status: z.enum(['installing', 'installed', 'failed']),
    step: z.number().int().min(0),
    totalSteps: z.number().int().min(0),
    percent: z.number().min(0).max(100),
    message: z.string(),
    error: z.string().nullable(),
  }),
  z.object({
    /** Install log lines (leveled: step=yellow, info=gray, error=red). */
    type: z.literal('install-log'),
    lines: z.array(installLogLineSchema),
    /** true = replay of the full trail → the client clears the console first. */
    reset: z.boolean().default(false),
    /** true = progress rewrite (bare \r): replaces the previous line. */
    replace: z.boolean().default(false),
  }),
]);

export type ConsoleServerMessage = z.infer<typeof consoleServerMessageSchema>;

/** install-status WS payload (console page banner). */
export type ConsoleInstallStatus = Extract<ConsoleServerMessage, { type: 'install-status' }>;

// ─── Node health (admin dashboard) ───────────────────────────────────────────

/**
 * System metrics of a NODE (the agent's host), pushed live to the admin
 * health page. Nothing is persisted — the panel and the agent both treat
 * these as ephemeral samples (Pelican semantics: health = last poll/push).
 */
export const nodeStatsSchema = z.object({
  timestamp: z.string().datetime(),
  /** Host-wide CPU usage, 0-100 (delta of os.cpus() idle vs total). */
  cpuPercent: z.number().min(0).max(100),
  memoryUsedMb: z.number().nonnegative(),
  memoryTotalMb: z.number().positive(),
  /** Disk of the agent's dataDir — null when statfs fails (network drive…). */
  diskUsedGb: z.number().nonnegative().nullable(),
  diskTotalGb: z.number().positive().nullable(),
  /** Agent process uptime. */
  uptimeSeconds: z.number().int().nonnegative(),
  version: z.string(),
  /** Number of game servers currently running on the node. */
  serversRunning: z.number().int().nonnegative(),
});

export type NodeStats = z.infer<typeof nodeStatsSchema>;

/**
 * Stats push cadence on the health WS — also the CPU measurement window.
 * Exported so the browser can match its chart animation to the frame rate.
 */
export const HEALTH_STATS_INTERVAL_MS = 1000;

/** TTL of a health JWT, in seconds — refreshed in-place by re-sending `auth`. */
export const HEALTH_TOKEN_TTL_SECONDS = 300;

/**
 * Payload of the health JWT (HS256, signed by the panel with the node's agent
 * token — same single per-node secret as the console JWT). Read-only scope:
 * no permissions to gate, the agent only ever PUSHES stats on this socket.
 */
export const healthTokenPayloadSchema = z.object({
  iss: z.literal('mojito-panel'),
  aud: z.literal('mojito-agent'),
  sub: z.string().min(1), // user id
  scope: z.literal('health'),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jti: z.string().min(1),
});

export type HealthTokenPayload = z.infer<typeof healthTokenPayloadSchema>;

/** Browser → agent (health WS). Same Pelican-style handshake as the console. */
export const healthClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    token: z.string().min(1).max(4096),
  }),
]);

export type HealthClientMessage = z.infer<typeof healthClientMessageSchema>;

export const healthErrorSchema = z.enum(['unauthorized', 'invalid-message']);

export type HealthError = z.infer<typeof healthErrorSchema>;

/** Agent → browser (health WS). */
export const healthServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth-ok') }),
  z.object({ type: z.literal('stats'), stats: nodeStatsSchema }),
  z.object({ type: z.literal('error'), code: healthErrorSchema }),
]);

export type HealthServerMessage = z.infer<typeof healthServerMessageSchema>;

/** Panel → browser response for "give me a node health token". */
export const healthTokenResponseSchema = z.object({
  token: z.string().min(1),
  wsUrl: z.string().min(1),
  /** Unix ms — the client refreshes by re-sending `auth` before this. */
  expiresAt: z.number().int().positive(),
});

export type HealthTokenResponse = z.infer<typeof healthTokenResponseSchema>;

// ─── File browser (panel → agent, panel proxies everything) ──────────────────

/**
 * Pelican parity: the panel PROXIES every file operation to the agent
 * (server-side fetch, panel token) — the browser never talks to the agent
 * directly for files. All paths are RELATIVE to the server's installDir,
 * POSIX-style (`plugins/config.yml`), and validated by the agent against
 * directory traversal (see the agent's resolveServerPath).
 */

/** Max size of a file the editor will read/write through the panel (1 Mo). */
export const MAX_EDITABLE_FILE_SIZE = 1024 * 1024;

/** Max decoded size of an upload carried through the panel (10 Mo). */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

export const fileObjectSchema = z.object({
  name: z.string().min(1),
  /** Relative POSIX path from the server root (dir + name). */
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  isDirectory: z.boolean(),
  modifiedAt: z.string().datetime().nullable(),
});

export type FileObject = z.infer<typeof fileObjectSchema>;

export const listFilesResponseSchema = z.object({
  files: z.array(fileObjectSchema),
});

export type ListFilesResponse = z.infer<typeof listFilesResponseSchema>;

export const readFileResponseSchema = z.object({
  path: z.string().min(1),
  /** UTF-8 text content — binary files must not be read through this route. */
  content: z.string(),
  size: z.number().int().nonnegative(),
});

export type ReadFileResponse = z.infer<typeof readFileResponseSchema>;

export const writeFileRequestSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export type WriteFileRequest = z.infer<typeof writeFileRequestSchema>;

export const createEntryRequestSchema = z.object({
  path: z.string().min(1),
  type: z.enum(['file', 'directory']),
});

export type CreateEntryRequest = z.infer<typeof createEntryRequestSchema>;

export const renameEntryRequestSchema = z.object({
  path: z.string().min(1),
  newPath: z.string().min(1),
});

export type RenameEntryRequest = z.infer<typeof renameEntryRequestSchema>;

export const deleteEntriesRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(100),
});

export type DeleteEntriesRequest = z.infer<typeof deleteEntriesRequestSchema>;

export const uploadFileRequestSchema = z.object({
  path: z.string().min(1),
  /** Base64 of the raw bytes — the agent enforces MAX_UPLOAD_SIZE decoded. */
  contentBase64: z.string().min(1),
});

export type UploadFileRequest = z.infer<typeof uploadFileRequestSchema>;

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
  /** File browser — every path is relative to the server's installDir. */
  filesList: 'GET /servers/:serverId/files',
  fileRead: 'GET /servers/:serverId/files/content',
  fileWrite: 'POST /servers/:serverId/files/content',
  fileCreate: 'POST /servers/:serverId/files/create',
  fileRename: 'POST /servers/:serverId/files/rename',
  fileDelete: 'POST /servers/:serverId/files/delete',
  fileUpload: 'POST /servers/:serverId/files/upload',
  /** Browser-facing console socket — auth by console JWT (?token=), NOT the panel token. */
  consoleWs: 'GET /servers/:serverId/ws',
  /** Node system snapshot (panel token) — latency measurement + one-shot health. */
  stats: 'GET /stats',
  /** Browser-facing node health socket — auth by health JWT, NOT the panel token. */
  healthWs: 'GET /health/ws',
} as const;
