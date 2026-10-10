import { isPidAlive } from '../environment/pid';
import type { ServerStore } from '../internal/server-store';
import type { StateStore } from '../internal/state-store';
import type { ServerManager } from './manager';

export interface RestoreOptions {
  store: ServerStore;
  stateStore: StateStore;
  manager: ServerManager;
  /** Called when a single server fails to restore — one failure must not block the rest. */
  onError?: (serverId: string, error: unknown) => void;
}

/**
 * Boot restore (≈ the wings boot loop in cmd/root.go):
 * for every installed server whose persisted state was running/starting —
 * 1. the pid is still alive → adopt (mark running, no live console — the
 *    process is never restarted just to please the agent),
 * 2. the pid is dead → full start (the machine/agent took the process down).
 * Servers persisted offline stay offline. The console buffer is NOT restored:
 * adopted servers run without live streaming until the next stop/start.
 */
export async function restoreServers(options: RestoreOptions): Promise<void> {
  const { store, stateStore, manager } = options;

  const storedServers = await store.list();
  for (const stored of storedServers) {
    const serverId = stored.serverId;
    try {
      const entry = await stateStore.get(serverId);
      if (!entry || (entry.state !== 'starting' && entry.state !== 'running')) {
        continue;
      }

      if (entry.pid !== null && isPidAlive(entry.pid)) {
        manager.adopt(serverId, entry.pid);
        continue;
      }

      // Was supposed to run but the process died with the machine/agent —
      // start it again (like wings re-starting a stopped container whose
      // persisted state was running).
      await manager.handlePowerAction(serverId, 'start');
    } catch (error) {
      options.onError?.(serverId, error);
    }
  }
}
