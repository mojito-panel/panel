import { useEffect, useRef, useState } from 'react';

/**
 * Continuous-flow animation for the live charts — WITHOUT recharts's morph.
 *
 * recharts restarts an interrupted animation from the PREVIOUS data shape:
 * at frame-rate cadence those restarts read as a yoyo (the curve bounces
 * back before reaching the new frame). Here WE drive the interpolation
 * instead (recharts renders with isAnimationActive={false}):
 * - on each new frame, a rAF loop glides the charted series LINEARLY
 *   from the CURRENT VISUAL state to the new frame, over exactly one
 *   frame interval — a continuous flow, never a step;
 * - a frame arriving mid-morph continues from the current visual state,
 *   so a restart-from-the-old-shape is impossible by construction.
 *
 * Only the CHARTED series glide (the `keys`); everything else
 * (timestamps, totals, version…) is taken from the target frame, so the
 * axis labels and stats stay honest.
 */

/** Render cap — recharts re-renders per emit, 30 fps is plenty for a 1 s flow. */
const EMIT_INTERVAL_MS = 33;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Returns a version of `samples` whose numeric `keys` flow continuously
 * toward the latest frame. `samples` must be the rolling WS buffer
 * (oldest → newest).
 */
export function useFlowSamples<T extends object>(
  samples: T[],
  intervalMs: number,
  keys: ReadonlyArray<keyof T & string>,
): T[] {
  const [display, setDisplay] = useState<T[]>(samples);
  /** Last EMITTED (visual) frame — the morph always continues from here. */
  const visualRef = useRef<T[]>(samples);
  // Effect key: the identity of an inline `keys` literal changes every
  // render — the effect must only re-run on the keys' CONTENT.
  const keysKey = keys.join(',');

  useEffect(() => {
    const from = visualRef.current;
    const to = samples;

    if (to.length === 0) {
      visualRef.current = to;
      setDisplay(to);
      return;
    }

    let raf = 0;
    let lastEmit = 0;
    const startedAt = performance.now();
    const glidingKeys = keysKey.split(',');

    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / intervalMs);
      if (t < 1) raf = requestAnimationFrame(tick);
      if (now - lastEmit < EMIT_INTERVAL_MS && t < 1) return;
      lastEmit = now;

      // Index-aligned pairing: at steady state the window slides, so slot i
      // glides toward the value its right neighbour had — the curve flows
      // left. During warmup identical indices are the same sample (no glide)
      // and the appended tail appears as-is.
      const frame = to.map((target, i) => {
        const source = from[i];
        if (!source) return target;
        const sourceRecord = source as Record<string, unknown>;
        const targetRecord = target as Record<string, unknown>;
        const gliding: Record<string, number> = {};
        for (const key of glidingKeys) {
          gliding[key] = lerp(Number(sourceRecord[key]), Number(targetRecord[key]), t);
        }
        return { ...target, ...gliding };
      });
      visualRef.current = frame;
      setDisplay(frame);

      if (t >= 1) {
        visualRef.current = to;
        setDisplay(to);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys enter via keysKey
  }, [samples, intervalMs, keysKey]);

  return display;
}
