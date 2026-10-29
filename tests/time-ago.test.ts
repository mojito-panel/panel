import { describe, it, expect } from 'vitest';

import { formatTimeAgo } from '~/components/time-ago';

const NOW = new Date('2026-10-29T14:00:00Z');

/** A date `ms` before NOW. */
function before(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe('formatTimeAgo', () => {
  it('reads "just now" under 10 seconds — and for a future date (clock skew)', () => {
    expect(formatTimeAgo(before(4_000), NOW)).toBe('just now');
    expect(formatTimeAgo(new Date(NOW.getTime() + 60_000), NOW)).toBe('just now');
  });

  it('counts seconds', () => {
    expect(formatTimeAgo(before(10_000), NOW)).toBe('10 seconds ago');
    expect(formatTimeAgo(before(59_999), NOW)).toBe('59 seconds ago');
  });

  it('counts minutes and hours', () => {
    expect(formatTimeAgo(before(60_000), NOW)).toBe('1 minute ago');
    expect(formatTimeAgo(before(119_999), NOW)).toBe('1 minute ago');
    expect(formatTimeAgo(before(120_000), NOW)).toBe('2 minutes ago');
    expect(formatTimeAgo(before(3_600_000), NOW)).toBe('1 hour ago');
    expect(formatTimeAgo(before(86_399_999), NOW)).toBe('23 hours ago');
  });

  it('counts days and weeks', () => {
    expect(formatTimeAgo(before(86_400_000), NOW)).toBe('1 day ago');
    expect(formatTimeAgo(before(6 * 86_400_000), NOW)).toBe('6 days ago');
    expect(formatTimeAgo(before(7 * 86_400_000), NOW)).toBe('1 week ago');
    expect(formatTimeAgo(before(29 * 86_400_000), NOW)).toBe('4 weeks ago');
  });

  it('counts months and years', () => {
    expect(formatTimeAgo(before(30 * 86_400_000), NOW)).toBe('1 month ago');
    expect(formatTimeAgo(before(364 * 86_400_000), NOW)).toBe('12 months ago');
    expect(formatTimeAgo(before(365 * 86_400_000), NOW)).toBe('1 year ago');
    expect(formatTimeAgo(before(3 * 365 * 86_400_000), NOW)).toBe('3 years ago');
  });
});
