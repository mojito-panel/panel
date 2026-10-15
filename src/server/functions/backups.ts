import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import type { EntityManager } from '@mikro-orm/core';
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql';
import { Backup, Node, Recipe } from '~/db/entities';
import { nanoid } from '~/lib/nanoid';
import type { IBackup, INode } from '~/db/types';
import type { BackupOperationStatus } from '~/contract';
import { serverBackupsList } from '~/lists/backups';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import { requireUser, HttpError, loadServerWithPermission } from '../session';
import { signBackupDownloadToken } from '../jwt';
import { decryptSecret } from '../crypto';
import {
  agentCreateBackup,
  agentGetBackupStatus,
  agentRestoreBackup,
  agentDeleteBackup,
  AgentError,
} from '../agent/client';
import {
  createBackupSchema,
  restoreBackupSchema,
  deleteBackupSchema,
  backupDownloadSchema,
} from '~/validators/server';
import { isHttpsScheme } from '~/validators/node';

/**
 * Backups (≈ Pelican's Backups tab, push-based): the panel row is the
 * source of truth; the agent archives under `dataDir/backups/<serverId>/`.
 * The agent cannot call the panel back — the list query SYNCS the rows of
 * in-flight operations by polling the agent, exactly like install statuses.
 */

type BackupStatusDb = 'pending' | 'running' | 'restoring' | 'completed' | 'failed';

const ACTIVE_STATUSES: BackupStatusDb[] = ['pending', 'running', 'restoring'];

function toDto(backup: IBackup) {
  return {
    id: backup.id,
    serverId: backup.serverId,
    name: backup.name,
    status: backup.status as BackupStatusDb,
    sizeBytes: backup.sizeBytes,
    checksum: backup.checksum ?? null,
    error: backup.error ?? null,
    completedAt: backup.completedAt?.toISOString() ?? null,
    createdAt: backup.createdAt?.toISOString() ?? null,
  };
}

/** Maps an AgentError onto the HttpError the client sees. */
function agentHttpError(action: string, err: AgentError): HttpError {
  // 404/409 keep their semantics (unknown, busy, installing…), the rest
  // is an upstream failure
  if (err.statusCode === 404 || err.statusCode === 409) {
    return new HttpError(err.statusCode, err.message);
  }
  return new HttpError(502, `${action} refusée par l'agent : ${err.message}`);
}

/**
 * Syncs every ACTIVE row with the agent's registry state. A 404 (agent
 * restarted, or the operation never started there) marks the row failed —
 * consistent with the "no frozen history" boot-restore philosophy. A
 * network failure leaves the row untouched (transient).
 */
async function syncActiveBackups(
  em: EntityManager,
  node: INode | null,
  serverId: string,
  rows: IBackup[],
): Promise<void> {
  const active = rows.filter((row) => ACTIVE_STATUSES.includes(row.status as BackupStatusDb));
  if (active.length === 0 || !node) return;

  for (const row of active) {
    try {
      const status = await agentGetBackupStatus(node, serverId, row.id);
      applyOperationStatus(row, status);
    } catch (err) {
      if (err instanceof AgentError && err.statusCode === 404) {
        row.status = 'failed';
        row.error = 'Opération interrompue (agent redémarré ou injoignable)';
        row.completedAt = new Date();
      }
      // Other errors (network…) — transient, the row stays as-is
    }
  }
}

/** Applies a polled agent status onto a panel row. */
function applyOperationStatus(row: IBackup, status: BackupOperationStatus): void {
  if (status.status === 'running') {
    row.status = status.operation === 'restore' ? 'restoring' : 'running';
    return;
  }
  row.status = status.status === 'completed' ? 'completed' : 'failed';
  row.sizeBytes = status.sizeBytes || row.sizeBytes;
  row.checksum = status.checksum ?? row.checksum;
  row.error = status.error;
  row.completedAt = status.finishedAt ? new Date(status.finishedAt) : new Date();
}

// ─── List (with in-flight status sync) ───────────────────────────────────────

/**
 * Query of the backups tab: the paginated list query PLUS the server it is
 * scoped to — the server id is a route param, not a search param, so it
 * travels alongside the rest of the payload.
 */
const listBackupsQuerySchema = serverBackupsList.querySchema.and(
  z.object({ serverId: z.string().min(1) }),
);

/**
 * Backups of ONE server — the in-flight rows are synced with the agent first
 * (a 404 marks them failed, a network error leaves them alone), then
 * filter/sort/pagination run in the database. The scoping `serverId` sits on the
 * query builder BEFORE `runListQuery`, so it applies to rows AND total.
 */
export const listBackupsFn = createServerFn({ method: 'POST' })
  .validator(listBackupsQuerySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.backups': ['read'],
    });

    // Sync needs every ACTIVE row of the server, not just the requested page.
    const all = await em.find(Backup, { serverId: server.id });
    const node = await em.findOne(Node, { id: server.nodeId });
    await syncActiveBackups(em, node, server.id, all);
    await em.flush();

    // `loadServerWithPermission` types its em loosely; the shared builder wants
    // the Postgres entity manager (same runtime object).
    const qb = listQueryBuilder(em as PostgreSqlEntityManager, Backup, serverBackupsList);
    qb.andWhere({ serverId: server.id });

    const { rows, rowCount } = await runListQuery(qb, serverBackupsList.spec, data);

    return {
      rowCount,
      rows: rows.map((backup) => ({
        id: backup.id,
        name: backup.name,
        status: backup.status as BackupStatusDb,
        sizeBytes: backup.sizeBytes,
        checksum: backup.checksum ?? null,
        error: backup.error ?? null,
        completedAt: backup.completedAt ?? null,
        createdAt: backup.createdAt,
      })),
    };
  });

// ─── Creation (limit check → row → agent order) ───────────────────────────────

export const createBackupFn = createServerFn({ method: 'POST' })
  .validator(createBackupSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.backups': ['create'],
    });

    // Pelican semantics: backup_limit counts the non-failed backups,
    // 0 disables backups entirely
    if (server.backupLimit <= 0) {
      throw new HttpError(403, 'Les sauvegardes sont désactivées sur ce serveur');
    }
    const rows = await em.find(Backup, { serverId: server.id });
    const activeCount = rows.filter((row) => row.status !== 'failed').length;
    if (activeCount >= server.backupLimit) {
      throw new HttpError(
        409,
        `Limite de sauvegardes atteinte (${server.backupLimit}) — supprime une ancienne sauvegarde`,
      );
    }

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    // The recipe declares the archive contents (glob include patterns)
    const recipe = await em.findOne(Recipe, { id: server.recipeId });
    if (!recipe) throw new HttpError(500, 'Recette introuvable');
    const recipeJson = recipe.json as { backup?: { include?: string[] } };

    const backupId = nanoid();
    const backup = em.create(Backup, {
      id: backupId,
      serverId: server.id,
      name: data.name?.trim() || `Sauvegarde du ${new Date().toLocaleString('fr-FR')}`,
      status: 'pending',
      sizeBytes: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    em.persist(backup);
    await em.flush();

    try {
      await agentCreateBackup(node, server.id, {
        backupId,
        include: recipeJson.backup?.include,
      });
      backup.status = 'running';
      await em.flush();
    } catch (err) {
      // The agent refused the order — the row is pure noise, drop it
      em.remove(backup);
      await em.flush();
      if (err instanceof AgentError) {
        throw agentHttpError('Création', err);
      }
      throw err;
    }

    return toDto(backup);
  });

// ─── Restoration (agent stops the server first) ──────────────────────────────

export const restoreBackupFn = createServerFn({ method: 'POST' })
  .validator(restoreBackupSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.backups': ['restore'],
    });

    const backup = await em.findOne(Backup, { id: data.backupId, serverId: server.id });
    if (!backup) throw new HttpError(404, 'Sauvegarde introuvable');

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    try {
      await agentRestoreBackup(node, server.id, backup.id, { truncate: data.truncate });
      backup.status = 'restoring';
      await em.flush();
      return { id: backup.id, status: 'restoring' as const };
    } catch (err) {
      if (err instanceof AgentError) {
        throw agentHttpError('Restauration', err);
      }
      throw err;
    }
  });

// ─── Deletion (agent archive + panel row) ────────────────────────────────────

export const deleteBackupFn = createServerFn({ method: 'POST' })
  .validator(deleteBackupSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.backups': ['delete'],
    });

    const backup = await em.findOne(Backup, { id: data.backupId, serverId: server.id });
    if (!backup) throw new HttpError(404, 'Sauvegarde introuvable');

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    try {
      await agentDeleteBackup(node, server.id, backup.id);
    } catch (err) {
      // A 404 (archive already gone on the node) is tolerated — the row
      // must still be removed. Anything else surfaces.
      if (!(err instanceof AgentError && err.statusCode === 404)) {
        if (err instanceof AgentError) {
          throw agentHttpError('Suppression', err);
        }
        throw err;
      }
    }

    em.remove(backup);
    await em.flush();
    return { id: backup.id, deleted: true };
  });

// ─── Download link (short-lived JWT, browser → agent) ─────────────────────────

export const getBackupDownloadUrlFn = createServerFn({ method: 'GET' })
  .validator(backupDownloadSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.backups': ['read'],
    });

    const backup = await em.findOne(Backup, { id: data.backupId, serverId: server.id });
    if (!backup) throw new HttpError(404, 'Sauvegarde introuvable');
    if (backup.status !== 'completed') {
      throw new HttpError(409, 'Cette sauvegarde n’est pas prête au téléchargement');
    }

    const node = await em.findOne(Node, { id: server.nodeId });
    if (!node) throw new HttpError(500, 'Node introuvable');

    // The browser downloads the archive directly from the agent with a
    // JWT scoped to this one backup (same per-node secret as the console)
    const { token, expiresAt } = signBackupDownloadToken(
      { userId: user.id, serverId: server.id, backupId: backup.id },
      decryptSecret(node.agentToken),
    );
    const url = `${isHttpsScheme(node.scheme) ? 'https' : 'http'}://${node.fqdn}:${node.publicPort}/servers/${server.id}/backups/${backup.id}/download?token=${token}`;

    return { url, expiresAt };
  });
