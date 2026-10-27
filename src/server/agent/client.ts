import type { INode } from '~/db/types';
import type {
  HealthResponse,
  InstallStatus,
  NodeStats,
  ServerAction,
  FileObject,
  BackupOperationStatus,
} from '~/contract';
import {
  backupOperationStatusSchema,
  healthResponseSchema,
  installStatusSchema,
  nodeStatsSchema,
} from '~/contract';
import { z } from 'zod';
import { decryptSecret } from '../crypto';
import { isHttpsScheme } from '~/validators/node';

/**
 * Panel-to-agent HTTP client (Bearer token).
 * Scheme follows the node setting (Pelican "Communicate over SSL") and
 * the port is the node's ACCESSIBLE port: behind a reverse proxy, the
 * proxy exposes the public port and the agent keeps listening on its own
 * (listen) port.
 * The node's agent token is stored encrypted at rest — it is decrypted here
 * on each call and never cached or logged.
 */

interface AgentCallOptions<T = unknown> {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Abort the call (timeout, e.g. dashboard agent healthchecks). */
  signal?: AbortSignal;
  /**
   * Contract schema the response must satisfy — defense against a buggy
   * or hostile agent feeding unvalidated data into panel DB rows.
   * Optional: endpoints whose Zod schema is known-stale relative to the
   * agent (server info) stay unvalidated for now.
   */
  schema?: z.ZodType<T>;
}

export class AgentError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function baseUrl(node: Pick<INode, 'fqdn' | 'publicPort' | 'scheme'>): string {
  return `${isHttpsScheme(node.scheme) ? 'https' : 'http'}://${node.fqdn}:${node.publicPort}`;
}

async function agentCall<T>(
  node: Pick<INode, 'fqdn' | 'publicPort' | 'scheme' | 'agentToken'>,
  path: string,
  options: AgentCallOptions<T> = {},
): Promise<T> {
  const response = await fetch(`${baseUrl(node)}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${decryptSecret(node.agentToken)}`,
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = typeof data.error === 'string' ? data.error : `Agent HTTP ${response.status}`;
    throw new AgentError(error, response.status);
  }

  if (options.schema) {
    return options.schema.parse(data);
  }
  return data as T;
}

// ─── Response types (aligned with the agent API) ───────────────────────────────

export interface AgentInstallResponse {
  serverId: string;
  status: string;
  message: string;
}

export interface AgentServerInfo {
  serverId: string;
  name: string;
  status: 'installing' | 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';
  runtimeState?: string;
  logs?: string[];
}

export interface AgentActionResponse {
  serverId: string;
  action: ServerAction;
  status: string;
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export async function agentHealth(
  node: INode,
  options: { signal?: AbortSignal } = {},
): Promise<HealthResponse> {
  return agentCall(node, '/health', { ...options, schema: healthResponseSchema });
}

/** Node system snapshot (CPU/RAM/disk) — the caller measures the round-trip as latency. */
export async function agentGetStats(
  node: INode,
  options: { signal?: AbortSignal } = {},
): Promise<NodeStats> {
  return agentCall(node, '/stats', { ...options, schema: nodeStatsSchema });
}

export async function agentInstallServer(
  node: INode,
  body: {
    serverId: string;
    name: string;
    recipe: unknown;
    /** Resolved runtime recipes of the app's requires graph (agent installs them first). */
    runtimes: unknown[];
    variables: Record<string, string | number | boolean>;
    installDir: string;
    resources: {
      port: number;
      memoryMb: number;
      cpuCores: number;
      ip?: string;
      /** Secondary ports (non-primary allocations) — see serverResourcesSchema. */
      ports?: number[];
    };
  },
): Promise<AgentInstallResponse> {
  return agentCall(node, '/servers/install', { method: 'POST', body });
}

export async function agentGetServer(node: INode, serverId: string): Promise<AgentServerInfo> {
  return agentCall(node, `/servers/${serverId}`);
}

/** Live (re)install status + step logs (poll while status === 'installing'). */
export async function agentGetInstallStatus(
  node: INode,
  serverId: string,
): Promise<InstallStatus> {
  return agentCall(node, `/servers/${serverId}/install`, { schema: installStatusSchema });
}

export interface AgentReinstallResponse {
  serverId: string;
  status: string;
  message: string;
}

/**
 * Reinstall — the agent stops the server then re-runs the recipe's install
 * script (in place). The panel sends the CURRENT recipe + variables.
 */
export async function agentReinstallServer(
  node: INode,
  serverId: string,
  body: {
    recipe: unknown;
    /** Resolved runtime recipes of the app's requires graph (agent installs them first). */
    runtimes: unknown[];
    variables: Record<string, string | number | boolean>;
  },
): Promise<AgentReinstallResponse> {
  return agentCall(node, `/servers/${serverId}/reinstall`, {
    method: 'POST',
    body: { recipe: body.recipe, runtimes: body.runtimes, variables: body.variables },
  });
}

/**
 * Syncs the agent's variable cache (its servers.json entry) with the panel
 * DB values. Panel DB stays the source of truth — the agent uses its copy
 * at start (including starts triggered directly over the browser WS, where
 * the panel is not in the loop). Same role as wings' config pull, but
 * pushed: the agent has no credentials to call the panel back.
 */
export async function agentUpdateServerVariables(
  node: INode,
  serverId: string,
  variables: Record<string, string | number | boolean>,
): Promise<{ serverId: string; variables: Record<string, string | number | boolean> }> {
  return agentCall(node, `/servers/${serverId}/variables`, {
    method: 'POST',
    body: { variables },
  });
}

/**
 * Pushes the server's FULL resources (Pelican "Network" page + the power
 * start/restart limits sync) to the agent's cache — the new port/ip/memory/
 * cpu apply at the NEXT start, a running process keeps its original
 * environment. The record is always complete: no partial chunks, the agent
 * replaces its stored resources wholesale.
 */
export async function agentUpdateResources(
  node: INode,
  serverId: string,
  resources: {
    port: number;
    ip: string;
    memoryMb: number;
    cpuCores: number;
    /** Secondary ports (non-primary allocations) — see serverResourcesSchema. */
    ports?: number[];
  },
): Promise<{
  serverId: string;
  resources: { port: number; memoryMb: number; cpuCores: number; ip: string; ports?: number[] };
}> {
  return agentCall(node, `/servers/${serverId}/resources`, {
    method: 'POST',
    body: { resources },
  });
}

export async function agentServerAction(
  node: INode,
  serverId: string,
  action: ServerAction,
): Promise<AgentActionResponse> {
  return agentCall(node, `/servers/${serverId}/action`, {
    method: 'POST',
    body: { action },
  });
}

export async function agentSendCommand(
  node: INode,
  serverId: string,
  command: string,
): Promise<{ serverId: string; sent: boolean }> {
  return agentCall(node, `/servers/${serverId}/command`, {
    method: 'POST',
    body: { command },
  });
}

export async function agentDeleteServer(
  node: INode,
  serverId: string,
): Promise<{ serverId: string; removed: boolean }> {
  return agentCall(node, `/servers/${serverId}`, { method: 'DELETE' });
}

// ─── File browser (panel proxies everything — see contract api.ts) ──────────

/** Lists a directory (relative POSIX path, '' = server root). */
export async function agentListFiles(
  node: INode,
  serverId: string,
  path: string,
): Promise<{ files: FileObject[] }> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return agentCall(node, `/servers/${serverId}/files${query}`);
}

export async function agentReadFile(
  node: INode,
  serverId: string,
  path: string,
): Promise<{ path: string; content: string; size: number }> {
  return agentCall(
    node,
    `/servers/${serverId}/files/content?path=${encodeURIComponent(path)}`,
  );
}

export async function agentWriteFile(
  node: INode,
  serverId: string,
  path: string,
  content: string,
): Promise<void> {
  await agentCall(node, `/servers/${serverId}/files/content`, {
    method: 'POST',
    body: { path, content },
  });
}

export async function agentCreateEntry(
  node: INode,
  serverId: string,
  path: string,
  type: 'file' | 'directory',
): Promise<void> {
  await agentCall(node, `/servers/${serverId}/files/create`, {
    method: 'POST',
    body: { path, type },
  });
}

export async function agentRenameEntry(
  node: INode,
  serverId: string,
  path: string,
  newPath: string,
): Promise<void> {
  await agentCall(node, `/servers/${serverId}/files/rename`, {
    method: 'POST',
    body: { path, newPath },
  });
}

export async function agentDeleteEntries(
  node: INode,
  serverId: string,
  paths: string[],
): Promise<void> {
  await agentCall(node, `/servers/${serverId}/files/delete`, {
    method: 'POST',
    body: { paths },
  });
}

export async function agentUploadFile(
  node: INode,
  serverId: string,
  path: string,
  contentBase64: string,
): Promise<void> {
  await agentCall(node, `/servers/${serverId}/files/upload`, {
    method: 'POST',
    body: { path, contentBase64 },
  });
}

// ─── Backups (panel orchestrates, agent archives & restores) ────────────────

/** Starts an archive creation on the agent (202 — poll the status). */
export async function agentCreateBackup(
  node: INode,
  serverId: string,
  body: { backupId: string; include?: string[] },
): Promise<BackupOperationStatus> {
  return agentCall(node, `/servers/${serverId}/backups`, {
    method: 'POST',
    body,
    schema: backupOperationStatusSchema,
  });
}

/** Live status of a backup operation (create or restore) — 404 when unknown. */
export async function agentGetBackupStatus(
  node: INode,
  serverId: string,
  backupId: string,
): Promise<BackupOperationStatus> {
  return agentCall(node, `/servers/${serverId}/backups/${backupId}`, {
    schema: backupOperationStatusSchema,
  });
}

/** Starts a restoration (the agent stops the server first) — poll the status. */
export async function agentRestoreBackup(
  node: INode,
  serverId: string,
  backupId: string,
  body: { truncate: boolean },
): Promise<BackupOperationStatus> {
  return agentCall(node, `/servers/${serverId}/backups/${backupId}/restore`, {
    method: 'POST',
    body,
    schema: backupOperationStatusSchema,
  });
}

/** Removes the archive file from the node. */
export async function agentDeleteBackup(
  node: INode,
  serverId: string,
  backupId: string,
): Promise<void> {
  await agentCall(node, `/servers/${serverId}/backups/${backupId}`, { method: 'DELETE' });
}
