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

// ─── better-auth rate limiting (~/lib/auth) ──────────────────────────────────

/**
 * Rate-limit configuration handed to better-auth (`rateLimit` option).
 * Exported from this PURE module so tests can assert the shape —
 * importing ~/lib/auth in a test would drag the ORM singleton (and its
 * Postgres connection) along, which is not feasible without the database.
 *
 * - global: 50 requests / 60 s per client IP across the auth endpoints;
 * - `/sign-in/email`: 10 attempts / 60 s — the password is REUSED for SFTP
 *   (see ~/lib/sftp), so the login door gets the strictest window. The
 *   custom rule REPLACES better-auth's built-in sign-in rule (3 / 10 s,
 *   which still allows ~1080 attempts/hour) with a tighter sustained cap
 *   (10 / 60 s = 600/hour max).
 *
 * Values chosen from the documented options of the installed better-auth
 * (v1.7): { enabled, window, max, customRules, storage }. Storage stays
 * in-memory (the panel is a single process — see the schedules runner's
 * single-instance note).
 */
export const AUTH_RATE_LIMIT = {
  enabled: true,
  window: 60,
  max: 50,
  customRules: {
    '/sign-in/email': { window: 60, max: 10 },
  },
} as const;
