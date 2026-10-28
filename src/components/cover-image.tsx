import { cn } from 'cn';

/**
 * Cover artwork of a marketplace card (a recipe of a registry, or the
 * registry itself) — one render for both.
 *
 * - a stored cover (base64 data URL) → the image, object-cover;
 * - nothing stored → a generated gradient, SEEDED by the entity id so the
 *   same card always wears the same colors (no flicker between renders)
 *   while different cards clearly differ: the seed hashes into two hues,
 *   a vivid top-left stop and a deeper bottom-right one.
 */

/** Deterministic 32-bit hash of a seed string. */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/** Slick two-stop gradient for a seed — vivid → deep, slightly tilted. */
function gradientFor(seed: string): string {
  const hash = hashSeed(seed);
  const hue = hash % 360;
  const secondHue = (hue + 40 + (hash % 80)) % 360;
  return `linear-gradient(160deg, hsl(${hue} 72% 52%), hsl(${secondHue} 68% 30%))`;
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
  className?: string;
}) {
  if (cover) {
    return (
      <img
        src={cover}
        alt=""
        loading="lazy"
        className={cn('absolute inset-0 h-full w-full object-cover', className)}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cn('absolute inset-0 h-full w-full', className)}
      style={{ backgroundImage: gradientFor(seed) }}
    />
  );
}
