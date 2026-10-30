import { cn } from 'cn';

import type { ServerStatusDb } from '~/db/types';

/**
 * Status display components — one place to restyle every status in the
 * panel (admin dashboard, server header, server sidebar, server list,
 * health page live pill, backup chips, install notice).
 *
 * One visual language for every status:
 * - A tinted chip (soft background, hairline border, colored label) whose
 *   TONE carries the meaning: green = healthy, amber = in progress, blue =
 *   installing, red = failure, neutral = idle/unknown.
 * - Inside the chip, a small dot. It is calm for steady states, breathes
 *   for in-progress ones, and grows sonar rings while the data behind it
 *   is live (< 20 s).
 */

/**
 * Panel-side server status (the DB-level union — contract statuses plus
 * the panel-only `install_failed` state). Lives here, next to the status
 * display, so any client module imports it from one place.
 */
export type PanelServerStatus = ServerStatusDb;

/**
 * Every status a badge renders: the server statuses (`ServerStatusDb`) +
 * the node online/offline pair + the node `unknown` default.
 */
export type BadgeStatus = ServerStatusDb | 'online' | 'offline' | 'unknown';

/** Live threshold: data behind a badge is "live" while fresher than this. */
export const LIVE_MAX_AGE_MS = 20_000;

/**
 * True when a query's last successful fetch is fresher than the live
 * threshold — the badge then shows the concentric sonar rings.
 */
export function isLiveData(query: { dataUpdatedAt: number }): boolean {
  return Date.now() - query.dataUpdatedAt < LIVE_MAX_AGE_MS;
}

/**
 * Tones of the status palette (chip tint + dot tint). `glow` is the dot's
 * own color fed to the breathing animation — a box-shadow cannot inherit a
 * background color, and `currentColor` would pick up the surrounding text.
 */
const TONES = {
  positive: {
    chip: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    glow: '[--led-glow:var(--color-emerald-500)]',
  },
  progress: {
    chip: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    glow: '[--led-glow:var(--color-amber-500)]',
  },
  active: {
    chip: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
    glow: '[--led-glow:var(--color-sky-500)]',
  },
  negative: {
    chip: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
    glow: '[--led-glow:var(--color-red-500)]',
  },
  neutral: {
    chip: 'border-border bg-muted/60 text-muted-foreground',
    dot: 'bg-muted-foreground/70',
    glow: '[--led-glow:var(--color-muted-foreground)]',
  },
} as const;

export type StatusTone = keyof typeof TONES;

/** Tone per status — anything unlisted is neutral. */
const STATUS_TONES: Partial<Record<BadgeStatus, StatusTone>> = {
  running: 'positive',
  online: 'positive',
  starting: 'progress',
  stopping: 'progress',
  installing: 'active',
  crashed: 'negative',
  install_failed: 'negative',
  offline: 'negative',
  stopped: 'neutral',
  unknown: 'neutral',
};

/** Transitional statuses — the dot breathes (an action is in progress). */
const IN_PROGRESS = new Set<BadgeStatus>(['starting', 'stopping', 'installing']);

/** French label per status. */
const LABELS: Record<BadgeStatus, string> = {
  starting: 'Démarrage…',
  running: 'En marche',
  online: 'En ligne',
  stopping: 'Arrêt en cours…',
  installing: 'Installation…',
  crashed: 'Planté',
  install_failed: 'Échec installation',
  offline: 'Hors ligne',
  stopped: 'Arrêté',
  unknown: 'Inconnu',
};

export function statusLabel(status: string): string {
  // Loose wire type on purpose: rows cross the boundary as plain strings
  // (the DB column) — an unknown status falls back to the raw value.
  return LABELS[status as BadgeStatus] ?? status;
}

/** Tone of a status (exported so pages can tint a matching element). */
export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status as BadgeStatus] ?? 'neutral';
}

/**
 * In-progress chip — the amber "progress" tone with a breathing dot
 * (starting up, shutting down, backup jobs, install notice).
 */
export function InProgressBadge({
  label,
  tone = 'progress',
}: {
  label: string;
  tone?: StatusTone;
}) {
  return <StatusChip tone={tone} label={label} breathing />;
}

/**
 * Status dot: a calm dot, a breathing one for in-progress statuses, or
 * concentric sonar rings while the data is live (< 20 s).
 */
export function StatusBall({
  status,
  live,
  className,
}: {
  status: string;
  live?: boolean;
  className?: string;
}) {
  const t = TONES[statusTone(status)];
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {live && (
        <>
          {/* Sonar rings — `size-full` (not `inset-0`): an absolutely
              positioned box with both insets set is stretched around the
              padding box, not laid out inside it, so it would not scale
              about the dot's center. An explicit 100% size keeps the
              transform origin on the wrapper's center. */}
          <span className={cn('animate-live-ring absolute size-full rounded-full', t.dot)} />
          <span
            className={cn(
              'animate-live-ring absolute size-full rounded-full [animation-delay:0.66s]',
              t.dot,
            )}
          />
        </>
      )}
      <span
        className={cn(
          'relative inline-flex size-2 rounded-full',
          t.dot,
          // The breathing glow takes the dot's own color (see --animate-led).
          IN_PROGRESS.has(status as BadgeStatus) && cn('animate-led', t.glow),
        )}
      />
    </span>
  );
}

/** The chip itself — shared by StatusBadge and InProgressBadge. */
function StatusChip({
  tone,
  label,
  status,
  live,
  breathing,
}: {
  tone: StatusTone;
  label: string;
  status?: string;
  live?: boolean;
  breathing?: boolean;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap',
        t.chip,
      )}
    >
      {status !== undefined ? (
        <StatusBall status={status} live={live} />
      ) : (
        <span
          className={cn(
            'inline-flex size-2 shrink-0 rounded-full',
            t.dot,
            breathing && cn('animate-led', t.glow),
          )}
        />
      )}
      {label}
    </span>
  );
}

/** Pill badge: status dot + label, tinted by the status tone. */
export function StatusBadge({
  status,
  live,
  className,
}: {
  status: string;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={className}>
      <StatusChip
        tone={statusTone(status)}
        label={statusLabel(status)}
        status={status}
        live={live}
      />
    </span>
  );
}

/**
 * "En direct" pill of the health page — concentric sonar rings while the
 * direct agent WS streams, muted while the connection is being
 * established.
 */
export function LiveIndicator({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
        live ? TONES.positive.chip : 'border-border bg-muted/60 text-muted-foreground',
      )}
    >
      <span className="relative inline-flex size-1.5">
        {live && (
          <>
            <span className="animate-live-ring absolute size-full rounded-full bg-emerald-500" />
            <span className="animate-live-ring absolute size-full rounded-full bg-emerald-500 [animation-delay:0.66s]" />
          </>
        )}
        <span
          className={cn(
            'relative inline-flex size-1.5 rounded-full',
            live ? 'bg-emerald-500' : 'bg-muted-foreground/70',
          )}
        />
      </span>
      {live ? 'en direct' : 'connexion…'}
    </span>
  );
}
