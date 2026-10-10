import { defineEntity, p } from '@mikro-orm/core';

// ─── better-auth (migrations managed by @better-auth/cli) ─────────────────────

export const User = defineEntity({
  name: 'user',
  properties: {
    id: p.text().primary(),
    name: p.string().length(128),
    email: p.text().unique(),
    emailVerified: p.boolean().fieldName('email_verified').default(false),
    image: p.text().nullable(),
    role: p.string().default('user'),
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

// ─── Business domain (MikroORM migrations, phase 3) ────────────────────────────────────

export const Node = defineEntity({
  name: 'node',
  properties: {
    id: p.string().primary(),
    name: p.string().length(128),
    fqdn: p.string().length(255),
    agentPort: p.integer().fieldName('agent_port').default(8080),
    /** Agent token (Bearer) — sent to the agent on every request. */
    agentToken: p.text().fieldName('agent_token'),
    lastSeenAt: p.datetime().fieldName('last_seen_at').nullable(),
    status: p.string().default('unknown'),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

export const Plugin = defineEntity({
  name: 'plugin',
  properties: {
    id: p.string().primary(),
    slug: p.string().length(128).unique(),
    name: p.string().length(128),
    schemaVersion: p.integer().fieldName('schema_version').default(1),
    json: p.json<Record<string, unknown>>(),
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
    pluginId: p.string().fieldName('plugin_id'),
    ownerId: p.string().fieldName('owner_id'),
    status: p.string().default('stopped'),
    variables: p.json<Record<string, string | number | boolean>>(),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
    updatedAt: p.datetime().fieldName('updated_at').onUpdate(() => new Date()),
  },
});

export const ServerAllocation = defineEntity({
  name: 'server_allocation',
  properties: {
    id: p.string().primary(),
    serverId: p.string().fieldName('server_id'),
    port: p.integer(),
    maxRamMb: p.integer().fieldName('max_ram_mb'),
    maxCpuPercent: p.integer().fieldName('max_cpu_percent').default(100),
    createdAt: p.datetime().fieldName('created_at').onCreate(() => new Date()),
  },
});
