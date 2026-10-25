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

// ─── Ids ──────────────────────────────────────────────────────────────────────

/**
 * Panel-generated id — any non-empty string. The panel uses nanoid()
 * (rows created before the nanoid migration hold a UUID); the format is
 * NOT part of the contract, so ids stay opaque on both sides.
 */

export const idSchema = z.string().min(1);

export type Id = z.infer<typeof idSchema>;

// ─── Server lifecycle (panel → agent) ─────────────────────────────────────────

/** Server resources (network + compute) — source of system variables (SERVER_PORT, SERVER_MEMORY...). */
export const serverResourcesSchema = z.object({
  port: z.number().int().positive(),
  /** Memory limit in MB — 0 = unlimited (no Job Object commit cap). */
  memoryMb: z.number().int().min(0),
  /** CPU limit in cores (0 = unlimited, halves OK: 1.5). */
  cpuCores: z.number().min(0).max(1024).default(0),
  ip: z.string().default('0.0.0.0'),
  /**
   * Secondary ports of the server (its non-primary allocations) — the
   * agent's allowed port set is [port, ...ports]. Purely informational
   * for the port watchdog (recipes keep templating SERVER_PORT from the
   * primary).
   */
  ports: z.array(z.number().int().positive()).default([]),
});

export type ServerResourcesPayload = z.infer<typeof serverResourcesSchema>;

export const installServerRequestSchema = z.object({
  serverId: idSchema,
  name: z.string().min(1),
  recipe: z.unknown(), // Recipe validated on the panel side, passed as-is
  /** Resolved runtime recipes of the app's requires graph (installed first). */
  runtimes: z.array(z.unknown()).default([]),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  installDir: z.string().min(1),
  resources: serverResourcesSchema,
});

export type InstallServerRequest = z.infer<typeof installServerRequestSchema>;

/**
 * Reinstall — same semantics as Pelican: the agent stops the server (if
 * running), then re-runs the recipe's install script in place. The panel
 * sends the CURRENT recipe (an update may have changed the install script);
 * the agent keeps its stored installDir and resources.
 */
export const reinstallServerRequestSchema = z.object({
  serverId: idSchema,
  recipe: z.unknown(), // Recipe validated by the agent, passed as-is
  /** Resolved runtime recipes of the app's requires graph (installed first). */
  runtimes: z.array(z.unknown()).default([]),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type ReinstallServerRequest = z.infer<typeof reinstallServerRequestSchema>;

/**
 * Variable update — the panel re-sends the server's FULL variable record
 * (all env → value entries, not only the edited ones). The agent validates
 * each value against the recipe's variable definitions, then updates its
 * stored entry: the new values are used on the NEXT start (a running
 * process keeps its original environment).
 */
export const updateServerVariablesRequestSchema = z.object({
  serverId: idSchema,
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type UpdateServerVariablesRequest = z.infer<
  typeof updateServerVariablesRequestSchema
>;

/**
 * Resources update (Pelican "set primary allocation" / port change, and
 * the power start/restart limits sync). The FULL record is pushed every
 * time — port, ip, memoryMb and cpuCores together, never partial chunks:
 * the panel is the source of truth and the agent replaces its stored
 * resources wholesale. The new values apply on the NEXT start — a
 * running process keeps its original environment.
 */
export const updateServerResourcesRequestSchema = z.object({
  serverId: idSchema,
  resources: z.object({
    port: z.number().int().positive(),
    ip: z.string().min(1),
    /** Memory limit in MB — 0 = unlimited (no Job Object commit cap). */
    memoryMb: z.number().int().min(0),
    cpuCores: z.number().min(0).max(1024).default(0),
    /** Secondary ports (non-primary allocations) — see serverResourcesSchema. */
    ports: z.array(z.number().int().positive()).default([]),
  }),
});

export type UpdateServerResourcesRequest = z.infer<
  typeof updateServerResourcesRequestSchema
>;

export const serverActionSchema = z.enum(['start', 'stop', 'restart', 'kill']);

export type ServerAction = z.infer<typeof serverActionSchema>;

export const serverActionRequestSchema = z.object({
  serverId: idSchema,
  action: serverActionSchema,
});

export type ServerActionRequest = z.infer<typeof serverActionRequestSchema>;

export const sendCommandRequestSchema = z.object({
  serverId: idSchema,
  command: z.string().min(1),
});

export type SendCommandRequest = z.infer<typeof sendCommandRequestSchema>;

// ─── Server status ────────────────────────────────────────────────────────────

export const serverStatusSchema = z.enum([
  'installing',
  'stopped',
  'starting',
  'running',
  'stopping',
  'crashed',
]);

export type ServerStatus = z.infer<typeof serverStatusSchema>;

export const serverInfoSchema = z.object({
  serverId: idSchema,
  status: serverStatusSchema,
  pid: z.number().int().positive().nullable(),
  ramMb: z.number().nonnegative().nullable(),
  cpuPercent: z.number().nonnegative().nullable(),
  startedAt: z.string().datetime().nullable(),
});

export type ServerInfo = z.infer<typeof serverInfoSchema>;

// ─── Install progress (agent → panel, via WS) ───────────────────────

export const installProgressSchema = z.object({
  serverId: idSchema,
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
/**
 * Parameters of a structured console message (`code` + `params`): the agent
 * sends the code, the panel renders the text itself (i18n-ready — the agent
 * never formats user-facing text). Raw lines (command output) carry only
 * `message`.
 */
export const consoleMessageParamsSchema = z.record(z.string(), z.string());

export type ConsoleMessageParams = z.infer<typeof consoleMessageParamsSchema>;

export const installLogLineSchema = z.object({
  timestamp: z.string().datetime(),
  /** step = step start (one color in the panel), info = command output (gray), error = stderr/failure. */
  level: z.enum(['info', 'step', 'error']),
  /** Raw text (command output) — empty when `code` carries a structured message. */
  message: z.string(),
  /** Message code — rendered by the panel's catalog (e.g. 'install.action.download'). */
  code: z.string().optional(),
  /** Parameters of `code`. Step lines also carry `step`/`total`. */
  params: consoleMessageParamsSchema.optional(),
});

export type InstallLogLine = z.infer<typeof installLogLineSchema>;

export const installStatusSchema = z.object({
  serverId: idSchema,
  status: z.enum(['installing', 'installed', 'failed']),
  step: z.number().int().min(0),
  totalSteps: z.number().int().min(0),
  percent: z.number().min(0).max(100),
  /** Raw fallback text — empty when `code` carries the current step's message. */
  message: z.string(),
  /** Code of the current step's message (rendered by the panel's catalog). */
  code: z.string().optional(),
  /** Parameters of `code`. */
  params: consoleMessageParamsSchema.optional(),
  error: z.string().nullable(),
  logs: z.array(installLogLineSchema),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});

export type InstallStatus = z.infer<typeof installStatusSchema>;

// ─── Live logs (agent → panel, via WS) ────────────────────────────────────────

export const logLineSchema = z.object({
  serverId: idSchema,
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
 * Full permission set — owners and admins get every permission; sub-users
 * get the subset granted on the panel (the token carries only their grants,
 * the agent enforces them on every message).
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
  serverId: idSchema,
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
    /** Code of the current step's message (rendered by the panel's catalog). */
    code: z.string().optional(),
    /** Parameters of `code`. */
    params: consoleMessageParamsSchema.optional(),
    error: z.string().nullable(),
  }),
  z.object({
    /**
     * Runtime console event (power action, watchdog finding, server online)
     * — a coded message the panel renders via its catalog. Buffered by the
     * agent and replayed on every fresh connection: `at` (unix ms) carries
     * the original emission time so a replayed event renders with the time
     * it happened, not the time of the reconnect.
     */
    type: z.literal('event'),
    code: z.string().min(1),
    params: consoleMessageParamsSchema.optional(),
    at: z.number().int().nonnegative().optional(),
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
 * POSIX-style (`recipes/config.yml`), and validated by the agent against
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

// ─── Backups (panel orchestrates, agent archives & restores) ──────────────────

/**
 * Pelican parity, push-based: the panel creates a `backup` row, POSTs the
 * order to the agent, then POLLS the operation status (the agent has no
 * credentials to call the panel back). Archives live on the agent under
 * `dataDir/backups/<serverId>/<backupId>.tar.gz` — outside the install dir,
 * so they never appear in the file browser nor in a restore-truncate.
 */

/** Operation tracked by the agent for one archive (creation or restoration). */
export const backupOperationSchema = z.enum(['create', 'restore']);

export type BackupOperation = z.infer<typeof backupOperationSchema>;

/** Creates a backup — the agent archives async (202), the panel polls. */
export const createBackupRequestSchema = z.object({
  serverId: idSchema,
  /** Panel-generated backup id — the archive file name on the agent. */
  backupId: idSchema,
  /** Overrides the recipe's include patterns for THIS backup (optional). */
  include: z.array(z.string().min(1)).optional(),
});

export type CreateBackupRequest = z.infer<typeof createBackupRequestSchema>;

/** Restores a backup onto the (stopped) server. */
export const restoreBackupRequestSchema = z.object({
  serverId: idSchema,
  /**
   * Wipe the install dir (except the agent's `.bin/`) before extracting —
   * destructive: files absent from the archive are LOST. Default: merge.
   */
  truncate: z.boolean().default(false),
});

export type RestoreBackupRequest = z.infer<typeof restoreBackupRequestSchema>;

/** Live status of a backup operation (create or restore), polled by the panel. */
export const backupOperationStatusSchema = z.object({
  serverId: idSchema,
  backupId: idSchema,
  operation: backupOperationSchema,
  status: z.enum(['running', 'completed', 'failed']),
  /** Archive size (0 until a create completes). */
  sizeBytes: z.number().int().nonnegative().default(0),
  /** SHA-256 of the archive (hex) — set when a create completes. */
  checksum: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable().default(null),
});

export type BackupOperationStatus = z.infer<typeof backupOperationStatusSchema>;

// ─── Backup download JWT (browser → agent, token issued by the panel) ────────

/**
 * TTL of a backup download JWT, in seconds — the browser downloads the
 * archive directly from the agent with it (same single per-node secret as
 * the console JWT, no presigned S3 machinery).
 */
export const BACKUP_DOWNLOAD_TOKEN_TTL_SECONDS = 120;

/**
 * Payload of the backup download JWT (HS256, signed by the panel with the
 * node's agent token). Scoped to ONE archive: `serverId` AND `backupId`
 * must match the download route parameters.
 */
export const backupDownloadTokenPayloadSchema = z.object({
  iss: z.literal('mojito-panel'),
  aud: z.literal('mojito-agent'),
  sub: z.string().min(1), // user id
  serverId: idSchema,
  backupId: idSchema,
  scope: z.literal('backup-download'),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jti: z.string().min(1),
});

export type BackupDownloadTokenPayload = z.infer<typeof backupDownloadTokenPayloadSchema>;

// ─── SFTP authentication (agent → panel, wings /api/sftp/auth model) ────────

/**
 * Pelican parity: the AGENT (shard) runs the SFTP server but delegates
 * credential validation to the panel — its password callback POSTs here,
 * authenticated with the node's agent token (the same shared per-node
 * secret the panel uses in the other direction). The username format is
 * `{username}.{serverId}` (split at the LAST dot — a username never
 * contains dots), and the password is the user's PANEL account password (like
 * Pelican, which verifies it against the user's account hash).
 */

/** Default SFTP listen port (wings default) — the node's `sftp_port`. */
export const DEFAULT_SFTP_PORT = 2022;

/**
 * Closed SFTP permission list enforced by the agent on every operation
 * (wings sftp/handler.go). `"*"` (owner/admin) is only ever granted by the
 * panel, never submitted.
 */
export const sftpPermissionSchema = z.enum([
  'file.read',
  'file.read-content',
  'file.create',
  'file.update',
  'file.delete',
]);

export type SftpPermission = z.infer<typeof sftpPermissionSchema>;

/** Shard → panel credential check. `ip` is informational (logging). */
export const sftpAuthRequestSchema = z.object({
  username: z.string().min(1).max(512),
  password: z.string().min(1).max(1024),
  ip: z.string().max(64).optional(),
});

export type SftpAuthRequest = z.infer<typeof sftpAuthRequestSchema>;

/** Panel → shard: the authenticated user, the matched server, its grants. */
export const sftpAuthResponseSchema = z.object({
  /** Panel user id (better-auth). */
  user: z.string().min(1),
  /** Server the username was scoped to — MUST belong to the calling node. */
  server: idSchema,
  /** `"*"` = full access (owner/admin), else the file.* permission list. */
  permissions: z.array(z.union([sftpPermissionSchema, z.literal('*')])),
});

export type SftpAuthResponse = z.infer<typeof sftpAuthResponseSchema>;

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
  /** Incremental runtime logs (live console fallback, cursor-based). */
  logs: 'GET /servers/:serverId/logs',
  variablesUpdate: 'POST /servers/:serverId/variables',
  resourcesUpdate: 'POST /servers/:serverId/resources',
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
  /** Backups — async archive create/restore, the panel polls the status. */
  backupCreate: 'POST /servers/:serverId/backups',
  backupStatus: 'GET /servers/:serverId/backups/:backupId',
  /** Archive download — panel token OR backup download JWT (browser link). */
  backupDownload: 'GET /servers/:serverId/backups/:backupId/download',
  backupDelete: 'DELETE /servers/:serverId/backups/:backupId',
  backupRestore: 'POST /servers/:serverId/backups/:backupId/restore',
  /** Browser-facing console socket — auth by console JWT sent as the first `auth` message, NOT the panel token. */
  consoleWs: 'GET /servers/:serverId/ws',
  /** Node system snapshot (panel token) — latency measurement + one-shot health. */
  stats: 'GET /stats',
  /** Browser-facing node health socket — auth by health JWT, NOT the panel token. */
  healthWs: 'GET /health/ws',
} as const;

/**
 * Route the AGENT calls on the PANEL (the only agent → panel call): SFTP
 * credential validation, authenticated with `Authorization: Bearer <agent
 * token>` of the calling node. See sftpAuthRequestSchema/sftpAuthResponseSchema.
 */
export const PANEL_ROUTES = {
  sftpAuth: 'POST /api/sftp/auth',
  /** Agent boot GC: the ids of the servers the panel still knows on the calling node. */
  agentServers: 'GET /api/agent/servers',
} as const;
