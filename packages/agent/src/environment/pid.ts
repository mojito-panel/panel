/**
 * Checks if a process is still alive, without sending a real signal.
 * A signal value of 0 is never delivered: it only probes for existence.
 * EPERM means the process exists but belongs to another user → alive.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
