import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createEntryRequestSchema,
  deleteEntriesRequestSchema,
  renameEntryRequestSchema,
  uploadFileRequestSchema,
  writeFileRequestSchema,
} from '@mojito/contract';
import { InvalidPathError } from '../files/paths';
import {
  EntryExistsError,
  FileNotFoundError,
  FileTooLargeError,
  WrongFileTypeError,
  filesService,
} from '../files/service';
import type { ServerStore } from '../internal/server-store';

export interface FilesRoutesOptions {
  store: ServerStore;
}

/** Maps file service errors to HTTP responses. */
function fileErrorReply(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof InvalidPathError) {
    return reply.code(400).send({ error: err.message, code: 'invalid_path' });
  }
  if (err instanceof FileNotFoundError) {
    return reply.code(404).send({ error: err.message, code: 'not_found' });
  }
  if (err instanceof WrongFileTypeError) {
    return reply.code(400).send({ error: err.message, code: 'wrong_type' });
  }
  if (err instanceof EntryExistsError) {
    return reply.code(409).send({ error: err.message, code: 'exists' });
  }
  if (err instanceof FileTooLargeError) {
    return reply.code(413).send({ error: err.message, code: 'too_large' });
  }
  return reply.code(500).send({ error: 'Erreur interne' });
}

/** Validates a JSON body against a schema — 400 with field details otherwise. */
function parseBody<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
): T | null {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400).send({
      error: 'Requête invalide',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return null;
  }
  return parsed.data;
}

/**
 * File browser routes (≈ wings router_server_files.go).
 * Every path is RELATIVE to the server's installDir — resolveServerPath
 * (files service) is the traversal gate.
 */
export function registerFilesRoutes(app: FastifyInstance, options: FilesRoutesOptions): void {
  const { store } = options;

  // Loads a stored server — 404 otherwise (same reply shape as router-server).
  async function loadStored(serverId: string, reply: FastifyReply) {
    const stored = await store.get(serverId);
    if (!stored) {
      await reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      return null;
    }
    return stored;
  }

  // ─── Directory listing ──────────────────────────────────────────────────
  app.get<{
    Params: { serverId: string };
    Querystring: { path?: string };
  }>('/servers/:serverId/files', async (request, reply) => {
    const stored = await loadStored(request.params.serverId, reply);
    if (!stored) return reply;
    try {
      const files = await filesService.listDirectory(stored.installDir, request.query.path ?? '');
      return { files };
    } catch (err) {
      return fileErrorReply(err, reply);
    }
  });

  // ─── Read text content (editor / download) ────────────────────────────────
  app.get<{
    Params: { serverId: string };
    Querystring: { path?: string };
  }>('/servers/:serverId/files/content', async (request, reply) => {
    const stored = await loadStored(request.params.serverId, reply);
    if (!stored) return reply;
    if (!request.query.path) {
      return reply.code(400).send({ error: 'Chemin manquant', code: 'invalid_path' });
    }
    try {
      return await filesService.readFile(stored.installDir, request.query.path);
    } catch (err) {
      return fileErrorReply(err, reply);
    }
  });

  // ─── Write text content ───────────────────────────────────────────────────
  app.post<{
    Params: { serverId: string };
  }>('/servers/:serverId/files/content', async (request, reply) => {
    const stored = await loadStored(request.params.serverId, reply);
    if (!stored) return reply;
    const body = parseBody(request, reply, writeFileRequestSchema);
    if (!body) return reply;
    try {
      await filesService.writeFile(stored.installDir, body.path, body.content);
      return reply.code(204).send();
    } catch (err) {
      return fileErrorReply(err, reply);
    }
  });

  // ─── Create file / folder ──────────────────────────────────────────────────
  app.post<{
    Params: { serverId: string };
  }>('/servers/:serverId/files/create', async (request, reply) => {
    const stored = await loadStored(request.params.serverId, reply);
    if (!stored) return reply;
    const body = parseBody(request, reply, createEntryRequestSchema);
    if (!body) return reply;
    try {
      await filesService.createEntry(stored.installDir, body.path, body.type);
      return reply.code(204).send();
    } catch (err) {
      return fileErrorReply(err, reply);
    }
  });

  // ─── Rename / move ─────────────────────────────────────────────────────────
  app.post<{
    Params: { serverId: string };
  }>('/servers/:serverId/files/rename', async (request, reply) => {
    const stored = await loadStored(request.params.serverId, reply);
    if (!stored) return reply;
    const body = parseBody(request, reply, renameEntryRequestSchema);
    if (!body) return reply;
    try {
      await filesService.renameEntry(stored.installDir, body.path, body.newPath);
      return reply.code(204).send();
    } catch (err) {
      return fileErrorReply(err, reply);
    }
  });

  // ─── Delete files / folders ────────────────────────────────────────────────
  app.post<{
    Params: { serverId: string };
  }>('/servers/:serverId/files/delete', async (request, reply) => {
    const stored = await loadStored(request.params.serverId, reply);
    if (!stored) return reply;
    const body = parseBody(request, reply, deleteEntriesRequestSchema);
    if (!body) return reply;
    try {
      await filesService.deleteEntries(stored.installDir, body.paths);
      return reply.code(204).send();
    } catch (err) {
      return fileErrorReply(err, reply);
    }
  });

  // ─── Upload (base64 through the panel) ─────────────────────────────────────
  app.post<{
    Params: { serverId: string };
  }>('/servers/:serverId/files/upload', async (request, reply) => {
    const stored = await loadStored(request.params.serverId, reply);
    if (!stored) return reply;
    const body = parseBody(request, reply, uploadFileRequestSchema);
    if (!body) return reply;
    try {
      await filesService.uploadFile(stored.installDir, body.path, body.contentBase64);
      return reply.code(204).send();
    } catch (err) {
      return fileErrorReply(err, reply);
    }
  });
}
