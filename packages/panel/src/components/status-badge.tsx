/**
 * Status display components — one place to restyle every status in the
 * panel (admin dashboard, server header, server sidebar, server list).
 *
 * The ball is a flat pulsing dot.
 */

/** Ball color per status (LED tint) — defaults to neutral gray. */
const BALL_COLORS: Record<string, string> = {
  running: 'bg-lime-400',
  online: 'bg-lime-400',
  installing: 'bg-blue-500',
  crashed: 'bg-red-500',
  install_failed: 'bg-red-500',
  offline: 'bg-destructive',
};

/** Pill tint per status — semi-transparent bg, text/border matching the ball. */
const PILL_COLORS: Record<string, string> = {
  running: 'border border-lime-400/50 bg-lime-400/15 text-lime-400',
  online: 'border border-lime-400/50 bg-lime-400/15 text-lime-400',
  installing: 'border border-blue-500/50 bg-blue-500/15 text-blue-500',
  crashed: 'border border-red-500/50 bg-red-500/15 text-red-500',
  install_failed: 'border border-red-500/50 bg-red-500/15 text-red-500',
  offline: 'border border-destructive/50 bg-destructive/15 text-destructive',
};

/** French label per status — defaults to the raw status. */
const LABELS: Record<string, string> = {
  running: 'En marche',
  online: 'En ligne',
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

/** Pulsing status dot. */
export function StatusBall({ status }: { status: string }) {
  return (
    <span
      className={`inline-block size-2.5 shrink-0 animate-pulse rounded-full ${
        BALL_COLORS[status] ?? 'bg-muted-foreground'
      }`}
    />
  );
}

/** Pill badge: pulsing dot + label. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        PILL_COLORS[status] ??
          'border border-muted-foreground/50 bg-muted-foreground/15 text-muted-foreground'
      }`}
    >
      <StatusBall status={status} />
      {statusLabel(status)}
    </span>
  );
}
