import { describe, expect, it } from 'vitest';

import { cronToHuman, isValidCron, isValidTimezone, nextCronRun } from '~/lib/cron';

/**
 * cronToHuman — French summaries of the cron patterns the schedules UI
 * produces; everything unrecognized falls back to the raw expression.
 */
describe('cronToHuman', () => {
  it('renders every-minute', () => {
    expect(cronToHuman('* * * * *')).toBe('Toutes les minutes');
  });

  it('renders step-minutes', () => {
    expect(cronToHuman('*/5 * * * *')).toBe('Toutes les 5 minutes');
    expect(cronToHuman('*/15 * * * *')).toBe('Toutes les 15 minutes');
  });

  it('renders step-hours instead of echoing the literal */2 (regression)', () => {
    // `0 */2 * * *` used to render "Tous les jours à */2:00"
    expect(cronToHuman('0 */2 * * *')).toBe('Toutes les 2 heures');
    expect(cronToHuman('0 */6 * * *')).toBe('Toutes les 6 heures');
  });

  it('renders daily at a plain time', () => {
    expect(cronToHuman('30 14 * * *')).toBe('Tous les jours à 14:30');
    expect(cronToHuman('0 0 * * *')).toBe('Tous les jours à 00:00');
    expect(cronToHuman('5 9 * * *')).toBe('Tous les jours à 09:05');
  });

  it('renders a day-of-week schedule', () => {
    expect(cronToHuman('0 9 * * 1')).toBe('Tous les lundis à 09:00');
    expect(cronToHuman('0 9 * * 0')).toBe('Tous les dimanches à 09:00');
    expect(cronToHuman('30 22 * * 7')).toBe('Tous les dimanches à 22:30');
  });

  it('falls back to the raw expression for unrecognized shapes', () => {
    // Day-of-month / month filters, lists and ranges stay verbatim
    expect(cronToHuman('30 4 1,15 * *')).toBe('30 4 1,15 * *');
    expect(cronToHuman('0 9 1-7 * *')).toBe('0 9 1-7 * *');
    expect(cronToHuman('0 9 * 12 1')).toBe('0 9 * 12 1');
    expect(cronToHuman('30 14 * * * 30 14')).toBe('30 14 * * * 30 14');
  });
});

describe('isValidCron', () => {
  it('accepts valid 5-field expressions', () => {
    expect(isValidCron('* * * * *')).toBe(true);
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('30 4 * * *')).toBe(true);
    expect(isValidCron('0 9 * * 1')).toBe(true);
    expect(isValidCron('0 4 1,15 * *')).toBe(true);
  });

  it('rejects anything that is not exactly 5 parseable fields', () => {
    expect(isValidCron('')).toBe(false);
    expect(isValidCron('* * * *')).toBe(false); // 4 fields
    expect(isValidCron('* * * * * *')).toBe(false); // 6 fields (seconds)
    expect(isValidCron('60 * * * *')).toBe(false); // minute out of range
    expect(isValidCron('* 25 * * *')).toBe(false); // hour out of range
    expect(isValidCron('abc * * * *')).toBe(false);
  });
});

describe('isValidTimezone', () => {
  it('accepts IANA zone names', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Europe/Paris')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
  });

  it('rejects unknown zones', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});

describe('nextCronRun', () => {
  // A fixed instant, evaluated from a stable reference: 2026-10-27T10:00:00Z
  const FROM = new Date('2026-10-27T10:00:00Z');

  it('returns the next occurrence strictly after the reference', () => {
    // Daily at 04:00 UTC — the 10-27 run already passed, so the next is 10-28
    const next = nextCronRun('0 4 * * *', 'UTC', FROM);
    expect(next).not.toBeNull();
    expect(next?.toISOString()).toBe('2026-10-28T04:00:00.000Z');
  });

  it('evaluates the expression in the schedule timezone (not the host clock)', () => {
    // 04:00 in Paris (UTC+1 in late October) is 03:00 UTC — from a 10:00Z
    // reference the next occurrence is the following day
    const next = nextCronRun('0 4 * * *', 'Europe/Paris', FROM);
    expect(next?.toISOString()).toBe('2026-10-28T03:00:00.000Z');
  });

  it('returns the next minute for an every-minute pattern', () => {
    const next = nextCronRun('* * * * *', 'UTC', FROM);
    expect(next?.toISOString()).toBe('2026-10-27T10:01:00.000Z');
  });

  it('returns null on an invalid pattern or timezone', () => {
    expect(nextCronRun('bogus', 'UTC', FROM)).toBeNull();
    expect(nextCronRun('0 4 * * *', 'Mars/Olympus', FROM)).toBeNull();
  });
});
