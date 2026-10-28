import { defineEntity, p } from '@mikro-orm/core';
import type { RegistryEntry } from '~/lib/recipe-source';

// ─── better-auth (migrations managed by MikroORM like everything else) ──────

export const User = defineEntity({
  name: 'user',
  properties: {
    id: p.text().primary(),
    name: p.string().length(128),
    username: p.string().length(32).unique().nullable(),
    email: p.text().unique(),
    emailVerified: p.boolean().fieldName('email_verified').default(false),
    image: p.text().nullable(),
    role: p.string().default('user'),
    // Admin plugin suspension (checked by better-auth at session creation).
    // p.string() = varchar(255): matches better-auth's own "string" fields.
    banned: p.boolean().default(false),
    banReason: p.string().length(255).fieldName('ban_reason').nullable(),
    banExpires: p.datetime().fieldName('ban_expires').nullable(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

export const Session = defineEntity({
  name: 'session',
  properties: {
    id: p.text().primary(),
    expiresAt: p.datetime().fieldName('expires_at'),
    token: p.string().unique(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
    ipAddress: p.string().fieldName('ip_address').nullable(),
    userAgent: p.string().fieldName('user_agent').nullable(),
    userId: p.text().fieldName('user_id'),
    // Admin plugin impersonation (who created this session, when impersonating)
    impersonatedBy: p.string().length(255).fieldName('impersonated_by').nullable(),
  },
});

export const Account = defineEntity({
  name: 'account',
  properties: {
    id: p.text().primary(),
    accountId: p.text().fieldName('account_id'),
    providerId: p.text().fieldName('provider_id'),
    userId: p.text().fieldName('user_id'),
    accessToken: p.text().fieldName('access_token').nullable(),
    refreshToken: p.text().fieldName('refresh_token').nullable(),
    idToken: p.text().fieldName('id_token').nullable(),
    accessTokenExpiresAt: p.datetime().fieldName('access_token_expires_at').nullable(),
    refreshTokenExpiresAt: p.datetime().fieldName('refresh_token_expires_at').nullable(),
    scope: p.text().nullable(),
    password: p.text().nullable(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

export const Verification = defineEntity({
  name: 'verification',
  properties: {
    id: p.string().primary(),
    identifier: p.string(),
    value: p.string(),
    expiresAt: p.datetime().fieldName('expires_at'),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()).nullable(),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()).nullable(),
  },
});

// ─── Business domain (Node, Recipe, Server, Allocation — migrations managed by MikroORM) ──

export const Node = defineEntity({
  name: 'node',
  properties: {
    id: p.string().primary(),
    name: p.string().length(128),
    fqdn: p.string().length(255),
    /** Scheme the panel and browsers use to reach the agent — Pelican
     * "Communicate over SSL": 'http', 'https' (TLS served by the agent) or
     * 'https-behind-proxy' (a reverse proxy terminates the TLS, the agent
     * itself stays in plain HTTP on its listen port). */
    scheme: p.string().default('http'),
    /** Listen port — the port the agent binds on the node (shard.yml
     * `api.port`). NOT the port clients connect to: see publicPort. */
    agentPort: p.integer().fieldName('agent_port').default(8080),
    /** Accessible port — the port the panel and browsers use to reach the
     * agent (differs from the listen port when a reverse proxy fronts the
     * agent, e.g. agent listening on 8080, public on 443). */
    publicPort: p.integer().fieldName('public_port').default(8080),
    /** SFTP listen port of the agent (shard.yml `sftp.port`), shown to users. */
    sftpPort: p.integer().fieldName('sftp_port').default(2022),
    /** Agent token (Bearer) — sent to the agent on every request. */
    agentToken: p.text().fieldName('agent_token'),
    lastSeenAt: p.datetime().fieldName('last_seen_at').nullable(),
    status: p.string().default('unknown'),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

export const Recipe = defineEntity({
  name: 'recipe',
  properties: {
    id: p.string().primary(),
    slug: p.string().length(128).unique(),
    name: p.string().length(128),
    schemaVersion: p.integer().fieldName('schema_version').default(1),
    json: p.json<Record<string, unknown>>(),
    /**
     * Provenance — WHERE this recipe came from (~/lib/recipe-source):
     * a direct https .json URL, or "<repo>#<branch>:<path>" for a registry
     * file. Null = hand-made: no update checks, the editor is the truth.
     */
    sourceUrl: p.text().fieldName('source_url').nullable(),
    /** Canonical hash of the recipe as imported/updated from the source. */
    sourceSha: p.text().fieldName('source_sha').nullable(),
    /**
     * Canonical hash of the upstream content at the last successful check —
     * null WITH remote_checked_at set means the check ran and found nothing
     * usable (the file disappeared upstream).
     */
    remoteSha: p.text().fieldName('remote_sha').nullable(),
    remoteCheckedAt: p.datetime().fieldName('remote_checked_at').nullable(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

/**
 * A recipe REGISTRY: any public https git repository added from the admin
 * marketplace, whose recipe files are imported in one click and checked for
 * updates. The sync (pg-boss job, src/server/registries.ts) clones the repo
 * depth 1, builds the catalog entries and caches them on the row — imports
 * read from the cache, they never clone.
 */
export const RecipeRegistry = defineEntity({
  name: 'recipe_registry',
  properties: {
    id: p.string().primary(),
    name: p.string().length(128),
    /** Canonical https git URL of the repository (~/lib/recipe-source). */
    url: p.text(),
    /** Branch tracked by the syncs — '' = the repository's default branch. */
    branch: p.string().length(128).default(''),
    /** Branch name the last sync resolved — feeds the recipe source URLs. */
    branchName: p.string().length(128).default(''),
    /** Catalog cache of the last sync (content included — null before it). */
    entries: p.json<RegistryEntry[]>().nullable(),
    /** HEAD commit SHA of the last sync — registry bookkeeping. */
    headSha: p.text().nullable(),
    lastSyncedAt: p.datetime().nullable(),
    /** Last sync failure (null on success) — shown on the marketplace page. */
    lastError: p.text().nullable(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

export const Server = defineEntity({
  name: 'server',
  properties: {
    id: p.string().primary(),
    name: p.string().length(128),
    nodeId: p.string().fieldName('node_id'),
    recipeId: p.string().fieldName('recipe_id'),
    ownerId: p.string().fieldName('owner_id'),
    status: p.string().default('stopped'),
    suspended: p.boolean().default(false),
    /** Memory limit (Mo) — source of SERVER_MEMORY, no host bridging in V1. */
    memoryMb: p.integer().fieldName('memory_mb').default(2048),
    /** CPU limit in cores (0 = unlimited, fractional OK — 1.5) — Job Object CPU rate. */
    cpuCores: p.double().fieldName('cpu_cores').default(0),
    /** Max non-failed backups kept for this server (0 = backups disabled). */
    backupLimit: p.integer().fieldName('backup_limit').default(5),
    variables: p.json<Record<string, string | number | boolean>>(),
    /**
     * Recipe SNAPSHOT of this server — ONE self-contained document, the
     * whole resolved graph at install time: `{ recipe, runtimes }`, where
     * `recipe` is the app recipe with the required runtimes' variable
     * definitions merged into `variables` (app declarations win on env
     * conflicts) and `runtimes` the resolved runtime recipes. Sent to the
     * agent as-is — a recipe edited later never touches a live server
     * until an explicit "reload recipe" re-snapshots it.
     */
    recipeSnapshot: p.json<Record<string, unknown>>().fieldName('recipe_snapshot').nullable(),
    /** When the snapshot was taken — drives the "recipe updated" reload button. */
    recipeSyncedAt: p.datetime().fieldName('recipe_synced_at').nullable(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

export const Allocation = defineEntity({
  name: 'allocation',
  properties: {
    id: p.string().primary(),
    /** Owning node — the IP:port pool is per node (Pelican semantics). */
    nodeId: p.string().fieldName('node_id'),
    /** Assigned server — null = free allocation in the node pool. */
    serverId: p.string().fieldName('server_id').nullable(),
    ip: p.string().length(255).default('0.0.0.0'),
    port: p.integer(),
    /** Human-readable name shown next to IP:port (Pelican alias). */
    alias: p.string().length(255).nullable(),
    /** Primary allocation of the server — source of SERVER_PORT / SERVER_IP. */
    primary: p.boolean().fieldName('is_primary').default(false),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
  },
});

export const ServerUser = defineEntity({
  name: 'server_user',
  properties: {
    id: p.string().primary(),
    serverId: p.string().fieldName('server_id'),
    userId: p.string().fieldName('user_id'),
    /**
     * Per-server permission grant of a sub-user, in the better-auth
     * statements shape ({ "server.files": ["read", "write"] }) — validated
     * against the catalog in `~/lib/permissions`.
     */
    permissions: p.json<Record<string, string[]>>(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
  uniques: [{ properties: ['serverId', 'userId'], name: 'server_user_server_user_unique' }],
});

export const PanelRole = defineEntity({
  name: 'role',
  properties: {
    /**
     * Slug-like id — it is the value stored in `user.role` (built-in names
     * 'admin'/'moderator'/'user' are reserved, custom roles get their id
     * from the display name).
     */
    id: p.string().primary(),
    name: p.string().length(128).unique(),
    description: p.text().nullable(),
    /**
     * Panel-level permission set of the custom role, in the better-auth
     * statements shape — validated against the catalog in
     * `~/lib/permissions` (never `server.*`: those are sub-user grants).
     */
    permissions: p.json<Record<string, string[]>>(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

export const Backup = defineEntity({
  name: 'backup',
  properties: {
    /** nanoid() — also the archive file name on the agent. */
    id: p.string().primary(),
    serverId: p.text().fieldName('server_id'),
    name: p.string().length(128),
    /** pending → running → completed | failed (`restoring` while a restore runs). */
    status: p.string().default('pending'),
    sizeBytes: p.integer().fieldName('size_bytes').default(0),
    /** SHA-256 of the archive (hex) — filled by the agent on completion. */
    checksum: p.text().nullable(),
    error: p.text().nullable(),
    completedAt: p.datetime().fieldName('completed_at').nullable(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
  // Declared to match the DB (the hand-written backup migration created it):
  // every backups query is scoped by server_id.
  indexes: [{ properties: ['serverId'], name: 'backup_server_id_index' }],
});

/**
 * Scheduled task chain of a server (Pelican "Schedules" tab): a cron
 * expression evaluated in the schedule's own timezone, plus an ordered
 * list of `schedule_task` rows (power actions / console commands with a
 * delay after the previous task).
 *
 * Trigger semantics mirror Pelican: `next_run_at` is COMPUTED AND
 * PERSISTED at write/claim time (never evaluated on the fly), the
 * background runner (`src/server/schedules.ts`) only compares dates —
 * `is_processing` claims a run so overlapping ticks cannot double-fire.
 * Task execution itself is delegated to pg-boss (durable delayed jobs:
 * a chain survives a panel restart).
 */
export const Schedule = defineEntity({
  name: 'schedule',
  properties: {
    id: p.string().primary(),
    serverId: p.string().fieldName('server_id'),
    name: p.string().length(128),
    /** 5-field unix cron expression — "30 4 * * *". */
    cron: p.string().length(64),
    /** IANA timezone the cron is evaluated in — "Europe/Paris". */
    timezone: p.string().length(64).default('UTC'),
    /** Inactive schedules never fire (an update also kills a running chain). */
    isActive: p.boolean().fieldName('is_active').default(true),
    /** Claim flag — true from the moment a run is queued until its last task. */
    isProcessing: p.boolean().fieldName('is_processing').default(false),
    /** Skip the run entirely when the server is not online (Pelican only_when_online). */
    onlyWhenOnline: p.boolean().fieldName('only_when_online').default(false),
    lastRunAt: p.datetime().fieldName('last_run_at').nullable(),
    /** Computed at write/claim time — the runner scans `next_run_at <= now`. */
    nextRunAt: p.datetime().fieldName('next_run_at').nullable(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
  indexes: [
    { properties: ['serverId'], name: 'schedule_server_id_index' },
    { properties: ['nextRunAt'], name: 'schedule_next_run_at_index' },
  ],
});

/**
 * One step of a schedule's task chain (Pelican "task"): an action with a
 * payload and a delay AFTER THE PREVIOUS TASK (0 = right away, 900 =
 * 15 minutes later). Executed sequentially by sequence_id — each job
 * queues the next one on the pg-boss queue with `startAfter`.
 */
export const ScheduleTask = defineEntity({
  name: 'schedule_task',
  properties: {
    id: p.string().primary(),
    scheduleId: p.string().fieldName('schedule_id'),
    /** Execution order within the chain — 1..n, renumbered on every edit. */
    sequenceId: p.integer().fieldName('sequence_id'),
    /** 'power' (payload: start/stop/restart/kill) | 'command' (payload: the console line). */
    action: p.string().length(16),
    payload: p.text(),
    /** Delay in seconds after the previous task (0-900). */
    timeOffset: p.integer().fieldName('time_offset').default(0),
    /** An agent failure does not stop the chain — the next task still runs. */
    continueOnFailure: p.boolean().fieldName('continue_on_failure').default(false),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
  indexes: [{ properties: ['scheduleId'], name: 'schedule_task_schedule_id_index' }],
});

/**
 * Panel-wide settings — Pelican-style EAV store: one row per namespaced
 * key ("app:name", "mail:smtp:host", …), value as text. Defaults live in
 * code (SETTING_DEFAULTS in ~/lib/settings) — DB rows are overrides only.
 * Any key can be FORCED by an environment variable (MOJITO_* mapping,
 * see ~/lib/settings), which then wins over the DB row.
 */
export const Setting = defineEntity({
  name: 'setting',
  properties: {
    /** Namespaced key — "app:name", "mail:smtp:host", … */
    key: p.string().length(128).primary(),
    /**
     * Stored value (text — booleans as "true"/"false"). Secrets
     * (mail:smtp:password) are encrypted at rest via encryptSecret.
     */
    value: p.text(),
  },
});

export const ActivityLog = defineEntity({
  name: 'activity_log',
  properties: {
    id: p.string().primary(),
    /** Namespaced event — "server:power", "backup:create", "subuser:add"… */
    event: p.string().length(128),
    /** Human-readable summary of the action (what happened, to what). */
    description: p.text().nullable(),
    ip: p.string().length(64).nullable(),
    userAgent: p.text().nullable(),
    /** Actor snapshot — denormalized so rows survive the actor's deletion. */
    actorId: p.string().nullable(),
    actorName: p.string().nullable(),
    actorEmail: p.string().nullable(),
    /** Subject server of the event, if any (denormalized id + name). */
    serverId: p.string().fieldName('server_id').nullable(),
    serverName: p.string().nullable(),
    /** Structured context of the event (target ids, changed fields…). */
    properties: p.json<Record<string, unknown>>().default('{}'),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
  },
  indexes: [
    { properties: ['event'], name: 'activity_log_event_index' },
    { properties: ['createdAt'], name: 'activity_log_created_at_index' },
    { properties: ['serverId'], name: 'activity_log_server_id_index' },
  ],
});
