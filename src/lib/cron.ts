/**
 * Cron helpers (pure TypeScript, client + server safe).
 *
 * Standard 5-field unix crontab expressions: `minute hour day-of-month
 * month day-of-week`. `cronToHuman` renders the patterns the schedules
 * UI actually produces as a short French summary; anything else falls
 * back to the raw expression (never wrong, just less friendly).
 *
 * `isValidCron` / `nextCronRun` do the real evaluation through croner
 * (zero dependency, client + server safe): the panel stores the next
 * occurrence of a schedule at write/claim time and only compares dates
 * afterwards — exactly Pelican's `Utilities::getScheduleNextRunDate`.
 */

import { Cron } from 'croner';

/** A cron expression is valid when it has exactly 5 fields AND croner parses it. */
export function isValidCron(cron: string): boolean {
  if (cron.trim().split(/\s+/).length !== 5) return false;
  try {
    // paused: no internal timer is armed — the instance only evaluates dates.
    new Cron(cron, { paused: true });
    return true;
  } catch {
    return false;
  }
}

/** An IANA timezone name is valid when Intl accepts it. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Next occurrence of a cron expression STRICTLY AFTER `from` (default:
 * now), evaluated in the given timezone (DST-aware) and returned as a
 * plain UTC-comparable Date. Null when the pattern or the timezone is
 * invalid — callers turn that into a 422.
 */
export function nextCronRun(cron: string, timezone: string, from: Date = new Date()): Date | null {
  try {
    return new Cron(cron, { paused: true, timezone }).nextRun(from) ?? null;
  } catch {
    return null;
  }
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;

/** A field is PLAIN when it is a single non-negative integer (`14`, `5`…) — no star, step, list or range. */
const PLAIN_NUMBER = /^\d+$/;

/** A STEP field (star + slash + N — "every Nth minute/hour"): returns the step, or null. */
function stepOf(field: string): number | null {
  const match = /^\*\/(\d+)$/.exec(field);
  return match ? Number(match[1]) : null;
}

/** Zero-pads a plain number field for display (`9` → `09`). */
function pad2(field: string): string {
  return field.padStart(2, '0');
}

/**
 * Renders a cron expression as a short French summary:
 *
 *   `* * * * *`   → "Toutes les minutes"
 *   star-slash-5… → "Toutes les 5 minutes"
 *   `0` star-slash-2… → "Toutes les 2 heures"
 *   `30 14 * * *` → "Tous les jours à 14:30"
 *   `0 9 * * 1`   → "Tous les lundis à 09:00"
 *
 * Unrecognized shapes (lists, ranges, day-of-month filters…) are
 * returned verbatim — the raw cron stays the source of truth.
 */
export function cronToHuman(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;
  const [min, hour, dayOfMonth, month, dayOfWeek] = fields;
  const daysOnly = dayOfMonth === '*' && month === '*';

  // Every minute
  if (min === '*' && hour === '*' && daysOnly && dayOfWeek === '*') {
    return 'Toutes les minutes';
  }

  // Step-minutes: every 5th minute (`*/5 * * * *` written in the cron itself)
  const minStep = stepOf(min);
  if (minStep !== null && hour === '*' && daysOnly && dayOfWeek === '*') {
    return minStep === 1 ? 'Toutes les minutes' : `Toutes les ${minStep} minutes`;
  }

  // Step-hours: every 2nd hour — the plain-time branch below must NOT run
  // for step fields (it would render the raw step as an hour: "*/2:00").
  const hourStep = stepOf(hour);
  if (min === '0' && hourStep !== null && daysOnly && dayOfWeek === '*') {
    return hourStep === 1 ? 'Toutes les heures' : `Toutes les ${hourStep} heures`;
  }

  // Daily at a plain time: 30 14 * * *
  if (PLAIN_NUMBER.test(min) && PLAIN_NUMBER.test(hour) && daysOnly && dayOfWeek === '*') {
    return `Tous les jours à ${pad2(hour)}:${pad2(min)}`;
  }

  // Weekly on a plain day: 0 9 * * 1 (0 and 7 = dimanche … 6 = samedi)
  const dow = Number(dayOfWeek);
  if (
    PLAIN_NUMBER.test(min) &&
    PLAIN_NUMBER.test(hour) &&
    daysOnly &&
    PLAIN_NUMBER.test(dayOfWeek) &&
    dow >= 0 &&
    dow <= 7
  ) {
    return `Tous les ${WEEKDAYS[dow % 7]}s à ${pad2(hour)}:${pad2(min)}`;
  }

  return cron;
}
