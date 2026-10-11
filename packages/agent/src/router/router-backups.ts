import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import {
  createBackupRequestSchema,
  restoreBackupRequestSchema,
  validateBackupIncludePattern,
} from '@mojito/contract';
import type { AgentConfig } from '../config';
import type { ServerStore } from '../internal/server-store';
import type { ServerManager } from '../server/manager';
import type { InstallRegistry } from '../server/installer/registry';
import type { BackupRegistry } from '../server/backup/registry';
import { startBackupCreate, startBackupRestore } from '../server/backup/runner';
import {
  BackupError,
  backupArchiveExists,
  removeBackupArchive,
  backupArchivePath,
} from '../server/backup/service';
import { hashToken, isAuthorized } from './middleware';
import { verifyBackupDownloadToken, TokenError } from './tokens/parser';

export interface BackupRoutesOptions {
  config: AgentConfig;
  store: ServerStore;
  manager: ServerManager;
  registry: BackupRegistry;
  installRegistry: InstallRegistry;
}

/**
 * Backup routes (≈ wings router_server_backup.go) — all behind the panel
 * token, EXCEPT the download route which also accepts a backup download
 * JWT (browser link signed by the panel with this node's token).
 */
export function registerBackupRoutes(app: FastifyInstance, options: BackupRoutesOptions): void {
  const { config, store, manager, registry, installRegistry } = options;
  const backupDir = resolve(config.dataDir, 'backups');

  const loadStored = async (serverId: string) => store.get(serverId);

  // ─── Backup creation (background, tracked in the registry) ─────────────
  app.post<{ Params: { serverId: string } }>(
    '/servers/:serverId/backups',
    async (request, reply) => {
      const parsed = createBackupRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }

      const stored = await loadStored(parsed.data.serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }
      if (installRegistry.isInstalling(parsed.data.serverId)) {
        return reply.code(409).send({
          error: 'Une installation est en cours',
          code: 'already_installing',
        });
      }
      if (registry.isBusy(parsed.data.serverId)) {
        return reply.code(409).send({
          error: 'Une sauvegarde est déjà en cours',
          code: 'backup_busy',
        });
      }
      for (const pattern of parsed.data.include ?? []) {
        const error = validateBackupIncludePattern(pattern);
        if (error) {
          return reply.code(400).send({ error, code: 'invalid_include' });
        }
      }

      startBackupCreate(
        { manager, registry, installRegistry, backupDir },
        stored,
        parsed.data.backupId,
        parsed.data.include,
      );

      const state = registry.get(parsed.data.serverId, parsed.data.backupId);
      return reply.code(202).send(state ? registry.toStatus(state) : { status: 'running' });
    },
  );

  // ─── Operation status (panel polling) ──────────────────────────────────
  app.get<{ Params: { serverId: string; backupId: string } }>(
    '/servers/:serverId/backups/:backupId',
    async (request, reply) => {
      const { serverId, backupId } = request.params;
      const stored = await loadStored(serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }
      const state = registry.get(serverId, backupId);
      if (!state) {
        // Unknown on this agent run (restarted, or never created here) —
        // the panel marks its pending/running row as failed.
        return reply.code(404).send({ error: 'Sauvegarde inconnue', code: 'not_found' });
      }
      return registry.toStatus(state);
    },
  );

  // ─── Restoration (background: stop → extract) ──────────────────────────
  app.post<{ Params: { serverId: string; backupId: string } }>(
    '/servers/:serverId/backups/:backupId/restore',
    async (request, reply) => {
      const parsed = restoreBackupRequestSchema.safeParse({
        serverId: request.params.serverId,
        ...(request.body as object),
      });
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Requête invalide',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }
      const { serverId, backupId } = request.params;

      const stored = await loadStored(serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }
      if (installRegistry.isInstalling(serverId)) {
        return reply.code(409).send({
          error: 'Une installation est en cours',
          code: 'already_installing',
        });
      }
      if (registry.isBusy(serverId)) {
        return reply.code(409).send({ error: 'Une sauvegarde est déjà en cours', code: 'backup_busy' });
      }
      if (!(await backupArchiveExists(backupDir, serverId, backupId))) {
        return reply.code(404).send({ error: 'Sauvegarde introuvable sur ce node', code: 'not_found' });
      }

      startBackupRestore(
        { manager, registry, installRegistry, backupDir },
        stored,
        backupId,
        parsed.data.truncate,
      );

      const state = registry.get(serverId, backupId);
      return reply.code(202).send(state ? registry.toStatus(state) : { status: 'running' });
    },
  );

  // ─── Archive deletion ───────────────────────────────────────────────────
  app.delete<{ Params: { serverId: string; backupId: string } }>(
    '/servers/:serverId/backups/:backupId',
    async (request, reply) => {
      const { serverId, backupId } = request.params;
      const stored = await loadStored(serverId);
      if (!stored) {
        return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
      }

      const state = registry.get(serverId, backupId);
      if (state?.status === 'running') {
        return reply.code(409).send({ error: 'Opération en cours sur cette sauvegarde', code: 'backup_busy' });
      }

      try {
        await removeBackupArchive(backupDir, serverId, backupId);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof BackupError && err.code === 'not_found') {
          return reply.code(404).send({ error: err.message, code: 'not_found' });
        }
        return reply.code(500).send({ error: 'Erreur interne' });
      }
    },
  );

  // ─── Archive download (panel token OR backup download JWT) ─────────────
  app.get<{
    Params: { serverId: string; backupId: string };
    Querystring: { token?: string };
  }>('/servers/:serverId/backups/:backupId/download', async (request, reply) => {
    const { serverId, backupId } = request.params;

    const stored = await loadStored(serverId);
    if (!stored) {
      return reply.code(404).send({ error: 'Serveur inconnu', code: 'not_found' });
    }

    // Auth: panel Bearer token, or a backup download JWT (browser link).
    if (!isAuthorized(request, hashToken(config.token))) {
      const token = request.query.token;
      if (!token) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      try {
        const payload = verifyBackupDownloadToken(token, config.token, { serverId });
        if (payload.backupId !== backupId) {
          return reply.code(403).send({ error: 'Forbidden' });
        }
      } catch (err) {
        if (err instanceof TokenError) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        throw err;
      }
    }

    if (!(await backupArchiveExists(backupDir, serverId, backupId))) {
      return reply.code(404).send({ error: 'Sauvegarde introuvable sur ce node', code: 'not_found' });
    }

    const archivePath = backupArchivePath(backupDir, serverId, backupId);
    reply.header('content-type', 'application/gzip');
    reply.header('content-disposition', `attachment; filename="${backupId}.tar.gz"`);
    return reply.send(createReadStream(archivePath));
  });
}
