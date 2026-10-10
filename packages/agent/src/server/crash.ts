import type { ServerStore } from '../internal/server-store';
import type { ServerInstance } from './server';
import { handlePowerAction } from './power';

/**
 * Crash detection (≈ wings server/crash.go):
 * an unclean exit (non-zero code, not a voluntary stop) → crashed +
 * auto restart if the last crash is old enough (anti-crash-loop).
 */
export async function handleUncleanExit(
  instance: ServerInstance,
  serverId: string,
  store: ServerStore,
  crashLoopMs: number,
): Promise<void> {
  const now = Date.now();
  const previousCrash = instance.lastCrashAt;
  instance.lastCrashAt = now;

  const stored = await store.get(serverId);
  if (!stored) return;

  // Anti-crash-loop (wings crash.go): the previous crash is too recent
  // → no auto restart, the server stays crashed.
  if (crashLoopMs > 0 && previousCrash !== null && now - previousCrash < crashLoopMs) {
    return;
  }

  // Auto restart: goes through the power lock again
  try {
    await handlePowerAction(instance, stored, 'start');
  } catch {
    // Auto restart failed — the server stays crashed
  }
}
