import type { INode } from '~/db/types';
import type { InstallStatus, ServerAction } from '@mojito/contract';
import { decryptSecret } from '../crypto';

/**
 * Panel-to-agent HTTP client (Bearer token).
 * V1: http — HTTPS (even self-signed) to be wired in prod.
 * The node's agent token is stored encrypted at rest — it is decrypted here
 * on each call and never cached or logged.
 */

interface AgentCallOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
}

export class AgentError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function baseUrl(node: Pick<INode, 'fqdn' | 'agentPort'>): string {
  return `http://${node.fqdn}:${node.agentPort}`;
}

async function agentCall<T>(
  node: Pick<INode, 'fqdn' | 'agentPort' | 'agentToken'>,
  path: string,
  options: AgentCallOptions = {},
): Promise<T> {
  const response = await fetch(`${baseUrl(node)}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${decryptSecret(node.agentToken)}`,
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const error = typeof data.error === 'string' ? data.error : `Agent HTTP ${response.status}`;
    throw new AgentError(error, response.status);
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
  status: 'installing' | 'stopped' | 'running' | 'crashed';
  runtimeState?: string;
  logs?: string[];
}

export interface AgentLogsChunk {
  serverId: string;
  lines: string[];
  next: number;
  status: 'installing' | 'stopped' | 'running' | 'crashed';
  runtimeState?: string;
}

export interface AgentActionResponse {
  serverId: string;
  action: ServerAction;
  status: string;
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export async function agentHealth(node: INode): Promise<{ status: string }> {
  return agentCall(node, '/health');
}

export async function agentInstallServer(
  node: INode,
  body: {
    serverId: string;
    name: string;
    plugin: unknown;
    variables: Record<string, string | number | boolean>;
    installDir: string;
    allocation: { port: number; memoryMb: number; ip?: string };
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
  return agentCall(node, `/servers/${serverId}/install`);
}

export interface AgentReinstallResponse {
  serverId: string;
  status: string;
  message: string;
}

/**
 * Reinstall — the agent stops the server then re-runs the plugin's install
 * script (in place). The panel sends the CURRENT plugin + variables.
 */
export async function agentReinstallServer(
  node: INode,
  serverId: string,
  body: {
    plugin: unknown;
    variables: Record<string, string | number | boolean>;
  },
): Promise<AgentReinstallResponse> {
  return agentCall(node, `/servers/${serverId}/reinstall`, {
    method: 'POST',
    body: { plugin: body.plugin, variables: body.variables },
  });
}

export async function agentGetServerLogs(
  node: INode,
  serverId: string,
  after: number,
): Promise<AgentLogsChunk> {
  return agentCall(node, `/servers/${serverId}/logs?after=${after}`);
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
