/**
 * Status display components — one place to restyle every status in the
 * panel (admin dashboard, server header, server sidebar, server list,
 * health page live pill, backup chips, install notice).
 *
 * Three visual tiers:
 * - Active statuses (running/online) — a soft halo expands continuously
 *   around the dot (beacon).
 * - In-progress statuses (starting/stopping/installing, backup jobs, the
 *   install notice) — a glassmorphic pill with a breathing LED indicator
 *   instead of the flat dot.
 * - Live data (< 20 s old) — concentric sonar rings around the dot.
 */

/** Live threshold: data behind a badge is "live" while fresher than this. */
export const LIVE_MAX_AGE_MS = 20_000;

/**
 * True when a query's last successful fetch is fresher than the live
 * threshold — the badge then shows the concentric sonar rings.
 */
export function isLiveData(query: { dataUpdatedAt: number }): boolean {
  return Date.now() - query.dataUpdatedAt < LIVE_MAX_AGE_MS;
}

/** Ball color per status (LED tint) — defaults to neutral gray. */
const BALL_COLORS: Record<string, string> = {
  starting: 'bg-amber-400',
  running: 'bg-lime-400',
  online: 'bg-lime-400',
  stopping: 'bg-amber-400',
  installing: 'bg-blue-500',
  crashed: 'bg-red-500',
  install_failed: 'bg-red-500',
  offline: 'bg-destructive',
};

/** Text tint matching the ball color — the LED glow reads currentColor. */
const LED_TEXT: Record<string, string> = {
  starting: 'text-amber-400',
  stopping: 'text-amber-400',
  installing: 'text-blue-500',
};

/** Pill tint per status — semi-transparent bg, text/border matching the ball. */
const PILL_COLORS: Record<string, string> = {
  running: 'border border-lime-400/50 bg-lime-400/15 text-lime-400',
  online: 'border border-lime-400/50 bg-lime-400/15 text-lime-400',
  crashed: 'border border-red-500/50 bg-red-500/15 text-red-500',
  install_failed: 'border border-red-500/50 bg-red-500/15 text-red-500',
  offline: 'border border-destructive/50 bg-destructive/15 text-destructive',
};

/** Transitional statuses — an action is in progress (glass LED pill). */
const IN_PROGRESS = new Set(['starting', 'stopping', 'installing']);

/** Steady "beacon" statuses — the dot broadcasts a soft expanding halo. */
const BEACON = new Set(['running', 'online']);

/** French label per status — defaults to the raw status. */
const LABELS: Record<string, string> = {
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
  return LABELS[status] ?? status;
}

/** Tones of the in-progress LED pill (indicator + glass tint). */
const LED_TONES = {
  amber: {
    led: 'bg-amber-400 text-amber-400',
    pill: 'border-amber-400/40 bg-amber-400/10 text-amber-600 dark:text-amber-400',
  },
  blue: {
    led: 'bg-blue-500 text-blue-500',
    pill: 'border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
} as const;

export type LedTone = keyof typeof LED_TONES;

/**
 * Glassmorphic in-progress pill — translucent blur backdrop with a
 * breathing LED indicator instead of the dot (starting up, shutting
 * down, installing, backup jobs, install notice).
 */
export function InProgressBadge({ label, tone = 'amber' }: { label: string; tone?: LedTone }) {
  const t = LED_TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-md ${t.pill}`}
    >
      <span className={`size-2 shrink-0 animate-led rounded-full ${t.led}`} />
      {label}
    </span>
  );
}

/**
 * Status dot: concentric sonar rings while the data is live (< 20 s),
 * a continuously expanding halo on active statuses, a breathing LED on
 * in-progress ones, a calm static dot otherwise.
 */
export function StatusBall({ status, live }: { status: string; live?: boolean }) {
  const color = BALL_COLORS[status] ?? 'bg-muted-foreground';
  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      {live ? (
        <>
          <span className={`absolute inset-0 animate-live-ring rounded-full ${color}`} />
          <span
            className={`absolute inset-0 animate-live-ring rounded-full ${color} [animation-delay:0.66s]`}
          />
        </>
      ) : BEACON.has(status) ? (
        <span className={`absolute inset-0 animate-halo rounded-full ${color}`} />
      ) : null}
      <span
        className={`relative inline-flex size-2.5 rounded-full ${color} ${
          IN_PROGRESS.has(status) ? `animate-led ${LED_TEXT[status]}` : ''
        }`}
      />
    </span>
  );
}

/** Pill badge: status dot + label — glass LED pill for in-progress statuses. */
export function StatusBadge({ status, live }: { status: string; live?: boolean }) {
  if (IN_PROGRESS.has(status)) {
    return (
      <InProgressBadge
        label={statusLabel(status)}
        tone={status === 'installing' ? 'blue' : 'amber'}
      />
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        PILL_COLORS[status] ??
        'border border-muted-foreground/50 bg-muted-foreground/15 text-muted-foreground'
      }`}
    >
      <StatusBall status={status} live={live} />
      {statusLabel(status)}
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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
        live
          ? 'border-lime-400/50 bg-lime-400/15 text-lime-400'
          : 'border-border bg-muted text-muted-foreground'
      }`}
    >
      <span className="relative inline-flex size-1.5">
        {live && (
          <>
            <span className="absolute inset-0 animate-live-ring rounded-full bg-lime-400" />
            <span
              className="absolute inset-0 animate-live-ring rounded-full bg-lime-400 [animation-delay:0.66s]"
            />
          </>
        )}
        <span
          className={`relative inline-flex size-1.5 rounded-full ${
            live ? 'bg-lime-400' : 'bg-muted-foreground'
          }`}
        />
      </span>
      {live ? 'en direct' : 'connexion…'}
    </span>
  );
}
