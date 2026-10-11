import type { BackupOperation, BackupOperationStatus } from '@mojito/contract';

/** In-memory state of one backup operation (creation or restoration). */
export interface BackupOpState {
  serverId: string;
  backupId: string;
  operation: BackupOperation;
  status: 'running' | 'completed' | 'failed';
  sizeBytes: number;
  checksum: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Terminal states kept per server — the panel polls a result right after
 * completion, even after another operation has started in between.
 */
const MAX_HISTORY_PER_SERVER = 10;

/**
 * Registry of backup operations (≈ the in-memory install registry): the
 * panel polls `GET /servers/:serverId/backups/:backupId` to follow a
 * create/restore — the agent has no credentials to call the panel back.
 * One operation at a time per server (Pelican's backup lock).
 */
export class BackupRegistry {
  readonly #states = new Map<string, BackupOpState[]>();

  /**
   * Starts an operation — returns null when one is already running on
   * this server (the router answers 409 in that case).
   */
  start(serverId: string, backupId: string, operation: BackupOperation): BackupOpState | null {
    if (this.isBusy(serverId)) return null;

    const state: BackupOpState = {
      serverId,
      backupId,
      operation,
      status: 'running',
      sizeBytes: 0,
      checksum: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    const history = this.#states.get(serverId) ?? [];
    history.push(state);
    if (history.length > MAX_HISTORY_PER_SERVER) {
      history.splice(0, history.length - MAX_HISTORY_PER_SERVER);
    }
    this.#states.set(serverId, history);
    return state;
  }

  /** State of one backup operation, or null when unknown (agent restart…). */
  get(serverId: string, backupId: string): BackupOpState | null {
    const history = this.#states.get(serverId);
    if (!history) return null;
    // Newest first: a restored backup reuses its create id, the LATEST
    // operation is the one being polled.
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].backupId === backupId) return history[i];
    }
    return null;
  }

  /** True while any operation is running on this server. */
  isBusy(serverId: string): boolean {
    const history = this.#states.get(serverId);
    if (!history) return false;
    return history.some((s) => s.status === 'running');
  }

  /** Marks an operation terminal (size/checksum on success, error otherwise). */
  finish(
    serverId: string,
    backupId: string,
    ok: boolean,
    patch: { sizeBytes?: number; checksum?: string | null; error?: string } = {},
  ): void {
    const state = this.get(serverId, backupId);
    if (!state || state.status !== 'running') return;
    state.status = ok ? 'completed' : 'failed';
    state.sizeBytes = patch.sizeBytes ?? state.sizeBytes;
    state.checksum = patch.checksum ?? state.checksum;
    state.error = ok ? null : (patch.error ?? 'Opération échouée');
    state.finishedAt = new Date().toISOString();
  }

  /** Serializable status (contract schema shape) returned by the router. */
  toStatus(state: BackupOpState): BackupOperationStatus {
    return {
      serverId: state.serverId,
      backupId: state.backupId,
      operation: state.operation,
      status: state.status,
      sizeBytes: state.sizeBytes,
      checksum: state.checksum,
      error: state.error,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
    };
  }
}
