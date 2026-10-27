/**
 * Minimal fixed-window rate limiter (in-memory) — the throttle for
 * server-side authentication endpoints that have no other protection
 * (the SFTP password callback relays user-supplied PANEL passwords on
 * behalf of agents). Counters are per-process: a multi-process
 * deployment would need a shared store, but a per-process cap already
 * blunts brute-force attempts relayed through a single agent.
 */
export class FixedWindowLimiter {
  #hits = new Map<string, { count: number; resetAt: number }>();
  #max: number;
  #windowMs: number;
  #now: () => number;

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /**
   * Registers one attempt for `key` and tells whether it is allowed.
   * Rejected attempts do NOT extend the window (classic fixed window:
   * the counter stops growing once the cap is hit, and the lockout
   * ends with the window).
   */
  allow(key: string): boolean {
    const now = this.#now();
    const hit = this.#hits.get(key);
    if (!hit || hit.resetAt <= now) {
      // Lazy bound: expired entries are replaced in place; a crude
      // full sweep keeps the map finite under key churn.
      if (this.#hits.size >= 10_000) this.#hits.clear();
      this.#hits.set(key, { count: 1, resetAt: now + this.#windowMs });
      return true;
    }
    if (hit.count >= this.#max) return false;
    hit.count += 1;
    return true;
  }

  /** Number of tracked keys (test helper). */
  get size(): number {
    return this.#hits.size;
  }
}
