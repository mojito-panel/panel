import { useEffect, useReducer, type ReactNode } from 'react';

/**
 * Relative "time ago" display: "just now", "20 seconds ago", "2 days ago"…
 * The full date shows on hover (title), and an optional prefix — an icon or
 * a text like "seen" — renders before the age.
 */

/** Largest age that still reads "just now" — future dates (clock skew) too. */
const JUST_NOW_MS = 10_000;

/** Label refresh cadence — the age must keep counting up on its own. */
const RESYNC_MS = 30_000;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** "N <unit>s ago" — English pluralization. */
function ago(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** Relative age of a date, English, with a granularity that grows with age. */
export function formatTimeAgo(date: Date, now: Date = new Date()): string {
  const ageMs = now.getTime() - date.getTime();
  if (ageMs < JUST_NOW_MS) return 'just now';
  if (ageMs < MINUTE) return ago(Math.floor(ageMs / 1_000), 'second');
  if (ageMs < HOUR) return ago(Math.floor(ageMs / MINUTE), 'minute');
  if (ageMs < DAY) return ago(Math.floor(ageMs / HOUR), 'hour');
  if (ageMs < WEEK) return ago(Math.floor(ageMs / DAY), 'day');
  if (ageMs < MONTH) return ago(Math.floor(ageMs / WEEK), 'week');
  if (ageMs < YEAR) return ago(Math.floor(ageMs / MONTH), 'month');
  return ago(Math.floor(ageMs / YEAR), 'year');
}

export function TimeAgo({
  date,
  prefix,
  locale = 'en-GB',
  className,
}: {
  /** Date to display — null or invalid renders an em dash. */
  date: Date | string | number | null | undefined;
  /** Icon or text rendered before the age ("seen", a RefreshCw icon…). */
  prefix?: ReactNode;
  /** Locale of the full hover date. */
  locale?: string;
  className?: string;
}) {
  // The label is time-based, not data-based: it re-renders on its own so
  // "just now" becomes "40 seconds ago" even on a page that never refetches.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, RESYNC_MS);
    return () => clearInterval(timer);
  }, []);

  const parsed = date == null ? null : new Date(date);
  if (parsed == null || Number.isNaN(parsed.getTime())) {
    return <span className={className}>—</span>;
  }
  return (
    <time
      className={className}
      dateTime={parsed.toISOString()}
      title={parsed.toLocaleString(locale)}
    >
      {prefix != null && <span className="mr-1 inline-flex items-center">{prefix}</span>}
      {formatTimeAgo(parsed)}
    </time>
  );
}
