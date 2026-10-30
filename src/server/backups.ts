import '@tanstack/react-start/server-only';
import { Backup, Node } from '~/db/entities';
import type { IBackup, INode, IServer } from '~/db/types';
import type { BackupOperationStatus } from '~/contract';
import { orm } from './orm';
import { HttpError } from './session';
import { serverRecipeSnapshot } from './recipe-snapshot';
import { agentCreateBackup, agentGetBackupStatus, AgentError } from './agent/client';

/**
 * Backups service (server-only, push-based — Pelican parity): the panel
 * `backup` row is the source of truth, the agent archives ASYNC under
 * `dataDir/backups/<serverId>/` — create the row, POST the order, then
 * POLL the operation status (the agent cannot call the panel back).
 *
 * Shared by the backups tab server functions (`server/functions/backups.ts`)
 * and the schedules runner: a `backup` task creates the archive AND waits
 * for it to finish before the next task fires (a stop → backup → start
 * chain must not start the server while it is still being archived).
 */

export type BackupStatusDb = 'pending' | 'running' | 'restoring' | 'completed' | 'failed';

/** Rows still in flight on the agent (synced by polling). */
export const ACTIVE_BACKUP_STATUSES: BackupStatusDb[] = ['pending', 'running', 'restoring'];

/** Bound on one agent call made while ordering/polling a backup. */
const BACKUP_CALL_TIMEOUT_MS = 30_000;

/** How often the schedules runner polls a backup operation's status. */
const BACKUP_POLL_INTERVAL_MS = 5_000;

/**
 * Longest a `backup` schedule task waits for the archive: 10 min. On
 * timeout the TASK fails (honoring `continue_on_failure`) but the backup
 * itself keeps running on the agent — the row stays `running` and the
 * backups list syncs it on its next poll.
 */
export const BACKUP_MAX_WAIT_MS = 10 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Applies a polled agent status onto a panel row. */
export function applyOperationStatus(row: IBackup, status: BackupOperationStatus): void {
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

/**
 * Syncs every ACTIVE row of a server with the agent's registry state. A 404
 * (agent restarted, or the operation never started there) marks the row
 * failed — consistent with the "no frozen history" boot-restore philosophy.
 * A network failure leaves the row untouched (transient).
 */
export async function syncActiveBackups(server: IServer, rows: IBackup[]): Promise<void> {
  const active = rows.filter((row) =>
    ACTIVE_BACKUP_STATUSES.includes(row.status as BackupStatusDb),
  );
  if (active.length === 0) return;
  const node = await orm.em.findOne(Node, { id: server.nodeId });
  if (!node) return;

  for (const row of active) {
    try {
      const status = await agentGetBackupStatus(node, server.id, row.id);
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

/**
 * Creates a backup row and orders the agent. Policy first (Pelican
 * semantics): `backup_limit` counts the non-failed backups, 0 disables
 * backups entirely. If the agent refuses the order the row is removed
 * again — it would be pure noise.
 */
export async function createBackup(
  server: IServer,
  options: { name?: string } = {},
): Promise<IBackup> {
  const em = orm.em;

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

  // The recipe SNAPSHOT declares the archive contents (glob include
  // patterns) — the stored document is what the agent installed, not the
  // (possibly edited-since) live recipe row. When no snapshot exists,
  // serverRecipeSnapshot backfills one from the recipe row.
  const snapshot = await serverRecipeSnapshot(server);
  const include = snapshot.recipe.backup?.include;

  const backup = em.create(Backup, {
    serverId: server.id,
    name: options.name?.trim() || `Sauvegarde du ${new Date().toLocaleString('fr-FR')}`,
    status: 'pending',
    sizeBytes: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  em.persist(backup);
  const backupId = backup.id; // generated by the entity's onCreate
  await em.flush();

  try {
    await agentCreateBackup(
      node,
      server.id,
      { backupId, include },
      { signal: AbortSignal.timeout(BACKUP_CALL_TIMEOUT_MS) },
    );
    backup.status = 'running';
    await em.flush();
  } catch (err) {
    // The agent refused the order — the row is pure noise, drop it
    em.remove(backup);
    await em.flush();
    throw err;
  }

  return backup;
}

/**
 * Polls a backup operation until it reaches a terminal state, applying the
 * status onto the panel row. Used by the schedules runner so the next task
 * of a chain only fires once the archive is DONE. Throws on failure or
 * timeout (the runner maps that onto `continue_on_failure`); on timeout the
 * row stays `running` — the agent keeps writing the archive regardless.
 * A 404 (agent restarted) fails the row and throws — no frozen history.
 */
export async function waitForBackupCompletion(
  node: INode,
  serverId: string,
  backup: IBackup,
): Promise<void> {
  const em = orm.em;
  const deadline = Date.now() + BACKUP_MAX_WAIT_MS;
  const timeoutMessage = `Sauvegarde « ${backup.name} » toujours en cours après ${Math.round(BACKUP_MAX_WAIT_MS / 60_000)} min`;

  for (;;) {
    let status: BackupOperationStatus;
    try {
      status = await agentGetBackupStatus(node, serverId, backup.id, {
        signal: AbortSignal.timeout(BACKUP_CALL_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof AgentError && err.statusCode === 404) {
        backup.status = 'failed';
        backup.error = 'Opération interrompue (agent redémarré ou injoignable)';
        backup.completedAt = new Date();
        await em.flush();
        throw new Error(backup.error);
      }
      if (Date.now() >= deadline) throw new Error(timeoutMessage);
      // Transient network error — poll again.
      await sleep(BACKUP_POLL_INTERVAL_MS);
      continue;
    }

    if (status.status !== 'running') {
      applyOperationStatus(backup, status);
      await em.flush();
      if (status.status === 'failed') {
        throw new Error(status.error ?? `Sauvegarde « ${backup.name} » échouée`);
      }
      return;
    }
    if (Date.now() >= deadline) throw new Error(timeoutMessage);
    await sleep(BACKUP_POLL_INTERVAL_MS);
  }
}
