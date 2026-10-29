import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter, AUTH_RATE_LIMIT } from '../src/lib/rate-limit';

describe('FixedWindowLimiter', () => {
  it('allows attempts up to the cap inside one window', () => {
    const limiter = new FixedWindowLimiter(3, 60_000, () => 1_000_000);
    expect(limiter.allow('user')).toBe(true);
    expect(limiter.allow('user')).toBe(true);
    expect(limiter.allow('user')).toBe(true);
    expect(limiter.allow('user')).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new FixedWindowLimiter(1, 60_000, () => 1_000_000);
    expect(limiter.allow('alice')).toBe(true);
    expect(limiter.allow('alice')).toBe(false);
    expect(limiter.allow('bob')).toBe(true);
  });

  it('rejects without resetting or extending the window', () => {
    let now = 1_000_000;
    const limiter = new FixedWindowLimiter(1, 60_000, () => now);
    expect(limiter.allow('user')).toBe(true);
    expect(limiter.allow('user')).toBe(false);
    // Rejected attempts do not extend the window: it still resets on time.
    now += 60_001;
    expect(limiter.allow('user')).toBe(true);
  });

  it('resets the counter when the window elapses', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(2, 60_000, () => now);
    expect(limiter.allow('user')).toBe(true);
    expect(limiter.allow('user')).toBe(true); // cap reached
    expect(limiter.allow('user')).toBe(false);
    now += 60_000;
    expect(limiter.allow('user')).toBe(true); // fresh window
  });

  it('stays bounded under key churn', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(1, 60_000, () => now);
    for (let i = 0; i < 20_000; i++) {
      limiter.allow(`user-${i}`);
      now += 1; // distinct keys, never expiring within the loop
    }
    expect(limiter.size).toBeLessThanOrEqual(10_000);
  });
});

/**
 * better-auth rate limiting — shape assertions on the config handed to
 * `betterAuth({ rateLimit })` (~/lib/auth). Behavior-level testing would
 * need the auth module, whose import initializes the ORM singleton (and
 * its Postgres connection) — not feasible without the dev database, so
 * the documented options (installed better-auth v1.7) are asserted here.
 */
describe('AUTH_RATE_LIMIT (better-auth config shape)', () => {
  it('is enabled with a bounded global window', () => {
    expect(AUTH_RATE_LIMIT.enabled).toBe(true);
    expect(AUTH_RATE_LIMIT.window).toBeGreaterThan(0);
    expect(AUTH_RATE_LIMIT.max).toBeGreaterThan(0);
  });

  it('throttles the login door strictly — the panel password is reused for SFTP', () => {
    const signIn = AUTH_RATE_LIMIT.customRules['/sign-in/email'];
    expect(signIn).toBeDefined();
    expect(signIn.max).toBeLessThan(AUTH_RATE_LIMIT.max);
  });
});
