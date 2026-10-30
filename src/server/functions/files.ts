import { createServerFn } from '@tanstack/react-start';

import { Node } from '~/db/entities';
import type { IUser } from '~/db/types';
import type { PermissionRequest } from '~/lib/permissions';
import {
  filesQuerySchema,
  filePathQuerySchema,
  fileDownloadSchema,
  saveFileSchema,
  createEntrySchema,
  renameEntrySchema,
  deleteEntriesSchema,
  uploadFileSchema,
} from '~/validators/files';
import { isHttpsScheme } from '~/validators/node';

import { AgentError } from '../agent/client';
import {
  agentListFiles,
  agentReadFile,
  agentWriteFile,
  agentCreateEntry,
  agentRenameEntry,
  agentDeleteEntries,
  agentUploadFile,
} from '../agent/client';
import { decryptSecret } from '../crypto';
import { signFileDownloadToken } from '../jwt';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import { requireUser, HttpError, loadServerWithPermission } from '../session';

/**
 * File browser server functions — the panel PROXIES every operation to the
 * agent (Pelican-style DaemonFileRepository): the browser never talks to the
 * agent directly for files. Every path is relative to the server root and
 * re-validated by the agent (traversal gate).
 */

/**
 * Loads the node that hosts a server, gated by a per-server permission —
 * the two things every proxied file operation needs:
 *
 * 1. the access gate: `loadServerWithPermission` throws 404 (unknown server)
 *    or 403 (sub-user without the matching `server.files` grant),
 * 2. the node to forward the call to (500 when its row is gone).
 *
 * Mirrors `loadServerWithPermission` (session.ts) — but returns the NODE,
 * since the handlers only ever proxy to the agent.
 */
async function loadNodeWithPermission(serverId: string, user: IUser, request: PermissionRequest) {
  const { server } = await loadServerWithPermission(serverId, user, request);
  const node = await orm.em.findOne(Node, { id: server.nodeId });
  if (!node) throw new HttpError(500, 'Node introuvable');
  return node;
}

/** Network-level failure codes (Node fetch / undici) — the agent is unreachable. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** True when the failure is a network-level error (agent down / unreachable). */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === 'fetch failed') return true;
  const code =
    (err as { code?: unknown }).code ?? (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

/**
 * Agent error → HttpError: agent status codes (404/409/413…) are meaningful,
 * network failures become a 503 with a user-facing message (the raw
 * "fetch failed" TypeError is useless to the end user).
 */
function mapAgentError(err: unknown): HttpError {
  if (err instanceof AgentError) {
    throw new HttpError(err.statusCode, err.message);
  }
  if (isNetworkError(err)) {
    throw new HttpError(
      503,
      'Agent injoignable — le nœud ne répond pas (vérifie que l’agent tourne et que son port est ouvert).',
    );
  }
  throw err;
}

// ─── Directory listing ──────────────────────────────────────────────────────

export const listFilesFn = createServerFn({ method: 'GET' })
  .validator(filesQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['read'] });
    try {
      return await agentListFiles(node, data.serverId, data.path);
    } catch (err) {
      throw mapAgentError(err);
    }
  });

// ─── Read (editor — UTF-8 text only, binaries refused by the agent) ─────────

export const readFileFn = createServerFn({ method: 'GET' })
  .validator(filePathQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['read'] });
    try {
      return await agentReadFile(node, data.serverId, data.path);
    } catch (err) {
      throw mapAgentError(err);
    }
  });

// ─── Download link (short-lived JWT, browser streams the file from the agent) ─

export const getFileDownloadUrlFn = createServerFn({ method: 'GET' })
  .validator(fileDownloadSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.files': ['read'],
    });
    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    // The browser downloads the file DIRECTLY from the agent with a JWT
    // scoped to this exact path (same per-node secret as the console) —
    // binaries included, the panel never proxies the bytes.
    const { token, expiresAt } = signFileDownloadToken(
      { userId: user.id, serverId: server.id, path: data.path },
      decryptSecret(node.agentToken),
    );
    const url = `${isHttpsScheme(node.scheme) ? 'https' : 'http'}://${node.fqdn}:${node.publicPort}/servers/${server.id}/files/download?path=${encodeURIComponent(data.path)}&token=${token}`;

    return { url, expiresAt };
  });

// ─── Save (editor) ──────────────────────────────────────────────────────────

export const saveFileFn = createServerFn({ method: 'POST' })
  .validator(saveFileSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['write'] });
    try {
      await agentWriteFile(node, data.serverId, data.path, data.content);
      return { saved: true };
    } catch (err) {
      throw mapAgentError(err);
    }
  });

// ─── Create file / folder ───────────────────────────────────────────────────

export const createEntryFn = createServerFn({ method: 'POST' })
  .validator(createEntrySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['create'] });
    const path = data.directory ? `${data.directory}/${data.name}` : data.name;
    try {
      await agentCreateEntry(node, data.serverId, path, data.type);
      return { created: true };
    } catch (err) {
      throw mapAgentError(err);
    }
  });

// ─── Rename ─────────────────────────────────────────────────────────────────

export const renameEntryFn = createServerFn({ method: 'POST' })
  .validator(renameEntrySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['write'] });
    // Same parent directory, new name — the path itself is agent-validated
    const parent = data.path.split('/').slice(0, -1).join('/');
    const newPath = parent ? `${parent}/${data.newName}` : data.newName;
    try {
      await agentRenameEntry(node, data.serverId, data.path, newPath);
      return { renamed: true };
    } catch (err) {
      throw mapAgentError(err);
    }
  });

// ─── Delete ──────────────────────────────────────────────────────────────────

export const deleteEntriesFn = createServerFn({ method: 'POST' })
  .validator(deleteEntriesSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['delete'] });
    try {
      await agentDeleteEntries(node, data.serverId, data.paths);
      return { deleted: true };
    } catch (err) {
      throw mapAgentError(err);
    }
  });

// ─── Upload (base64 through the panel) ───────────────────────────────────────

export const uploadFileFn = createServerFn({ method: 'POST' })
  .validator(uploadFileSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['create'] });
    const path = data.directory ? `${data.directory}/${data.filename}` : data.filename;
    try {
      await agentUploadFile(node, data.serverId, path, data.contentBase64);
      return { uploaded: true };
    } catch (err) {
      throw mapAgentError(err);
    }
  });
