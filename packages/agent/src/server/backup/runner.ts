import type { StoredServer } from '../../internal/server-store';
import type { ServerManager } from '../manager';
import type { InstallRegistry } from '../installer/registry';
import type { BackupRegistry } from './registry';
import { createBackupArchive, restoreBackupArchive } from './service';

/** Everything the background backup runners need. */
export interface BackupRunnerDeps {
  manager: ServerManager;
  registry: BackupRegistry;
  installRegistry: InstallRegistry;
  /** Root dir of all archives (`dataDir/backups`). */
  backupDir: string;
  /** Called when a background operation fails — logging hook. */
  onError?: (serverId: string, error: unknown) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts a backup creation in the BACKGROUND (202 semantics, like a
 * tracked install): the runner records every state transition in the
 * registry and the panel polls the status.
 */
export function startBackupCreate(
  deps: BackupRunnerDeps,
  stored: StoredServer,
  backupId: string,
  include?: string[],
): void {
  if (!deps.registry.start(stored.serverId, backupId, 'create')) return;

  void (async () => {
    try {
      const result = await createBackupArchive({
        installDir: stored.installDir,
        backupDir: deps.backupDir,
        serverId: stored.serverId,
        backupId,
        include,
      });
      deps.registry.finish(stored.serverId, backupId, true, result);
    } catch (error) {
      deps.registry.finish(stored.serverId, backupId, false, {
        error: errorMessage(error),
      });
      deps.onError?.(stored.serverId, error);
    }
  })();
}

/**
 * Starts a restoration in the BACKGROUND: the server is STOPPED first
 * (graceful stop + kill, like a reinstall), then the archive is extracted
 * — optionally truncating the install dir first. The server stays stopped
 * after the restore; the user starts it again.
 */
export function startBackupRestore(
  deps: BackupRunnerDeps,
  stored: StoredServer,
  backupId: string,
  truncate: boolean,
): void {
  if (!deps.registry.start(stored.serverId, backupId, 'restore')) return;

  void (async () => {
    try {
      if (deps.manager.isRunning(stored.serverId)) {
        await deps.manager.handlePowerAction(stored.serverId, 'stop');
      }
      await restoreBackupArchive({
        installDir: stored.installDir,
        backupDir: deps.backupDir,
        serverId: stored.serverId,
        backupId,
        truncate,
      });
      deps.registry.finish(stored.serverId, backupId, true);
    } catch (error) {
      deps.registry.finish(stored.serverId, backupId, false, {
        error: errorMessage(error),
      });
      deps.onError?.(stored.serverId, error);
    }
  })();
}
