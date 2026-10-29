import { useState } from 'react';
import { cn } from 'cn';

/**
 * Cover artwork of a marketplace card (a recipe of a registry, or the
 * registry itself) — one render for both.
 *
 * SELF-CONTAINED: the component owns its box (`relative aspect-[2/3]
 * overflow-hidden`), so it can drop anywhere in a card without its callers
 * remembering a positioned wrapper — an absolute fill placed directly in a
 * non-relative parent would size to the nearest positioned ancestor, i.e.
 * the whole page.
 *
 * - a stored cover (base64 data URL) → the image, object-cover;
 * - nothing stored → a generated gradient, SEEDED by the entity id so the
 *   same card always wears the same colors (no flicker between renders)
 *   while different cards still differ: the seed hashes into two adjacent
 *   hues, a muted dark top-left stop into a deeper bottom-right one —
 *   sober and low-contrast, never flashy.
 *
 * The gradient is ALWAYS painted underneath the <img>, so a cover with
 * transparent areas (PNG without background) reads correctly in the
 * marketplace grid instead of showing the card behind it.
 */

/** Deterministic 32-bit hash of a seed string. */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/** Sober two-stop gradient for a seed — dark, muted, slightly tilted. */
function gradientFor(seed: string): string {
  const hash = hashSeed(seed);
  const hue = hash % 360;
  // Analogous hues (20-44° apart): a gentle shift, not a hard contrast.
  const secondHue = (hue + 20 + (hash % 25)) % 360;
  return `linear-gradient(160deg, hsl(${hue} 40% 28%), hsl(${secondHue} 36% 16%))`;
}

export function CoverImage({
  cover,
  seed,
  className,
}: {
  /** Stored cover (base64 data URL) — null/undefined = generated gradient. */
  cover: string | null | undefined;
  /** Stable seed of the gradient (the entity id). */
  seed: string;
  /** Rounded corners / borders where the card meets the cover. */
  className?: string;
}) {
  // A broken artwork URL (bad base64, 404 data URL…) hides the <img> so
  // the gradient underneath shows instead of a torn-image icon. Tracked
  // per URL: a re-sync that brings a NEW cover gets a fresh chance.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const showImage = cover !== null && cover !== undefined && cover !== brokenUrl;

  return (
    <div
      className={cn('relative aspect-[2/3] w-full overflow-hidden bg-muted', className)}
    >
      {/* Gradient always painted underneath — the fallback of a missing
          OR failed cover, and the backdrop that shows through the
          transparent areas of a loaded one. */}
      <div
        aria-hidden
        className="absolute inset-0 h-full w-full"
        style={{ backgroundImage: gradientFor(seed) }}
      />
      {showImage && cover && (
        <img
          src={cover}
          alt=""
          loading="lazy"
          onError={() => setBrokenUrl(cover)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
