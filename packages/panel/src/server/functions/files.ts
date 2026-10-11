import { createServerFn } from '@tanstack/react-start';
import { initOrm } from '~/db';
import { Node } from '~/db/entities';
import type { IUser } from '~/db/types';
import {
  requireUser,
  HttpError,
  loadServerWithPermission,
} from '../session';
import type { PermissionRequest } from '~/lib/permissions';
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
import {
  filesQuerySchema,
  filePathQuerySchema,
  saveFileSchema,
  createEntrySchema,
  renameEntrySchema,
  deleteEntriesSchema,
  uploadFileSchema,
} from '~/validators/files';

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
async function loadNodeWithPermission(
  serverId: string,
  user: IUser,
  request: PermissionRequest,
) {
  const { server } = await loadServerWithPermission(serverId, user, request);
  const orm = await initOrm();
  const em = orm.em.fork();
  const node = await em.findOne(Node, { id: server.nodeId });
  if (!node) throw new HttpError(500, 'Node introuvable');
  return node;
}

/** Agent error → HttpError: agent status codes (404/409/413…) are meaningful. */
function mapAgentError(err: unknown): HttpError {
  if (err instanceof AgentError) {
    throw new HttpError(err.statusCode, err.message);
  }
  throw err;
}

// ─── Directory listing ──────────────────────────────────────────────────────

export const listFilesFn = createServerFn({ method: 'GET' })
  .validator(filesQuerySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['read'] });
    try {
      return await agentListFiles(node, data.serverId, data.path);
    } catch (err) {
      throw mapAgentError(err);
    }
  });

// ─── Read (editor / download) ───────────────────────────────────────────────

export const readFileFn = createServerFn({ method: 'GET' })
  .validator(filePathQuerySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const node = await loadNodeWithPermission(data.serverId, user, { 'server.files': ['read'] });
    try {
      return await agentReadFile(node, data.serverId, data.path);
    } catch (err) {
      throw mapAgentError(err);
    }
  });

// ─── Save (editor) ──────────────────────────────────────────────────────────

export const saveFileFn = createServerFn({ method: 'POST' })
  .validator(saveFileSchema)
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
