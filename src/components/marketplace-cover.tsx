import { Gamepad2 } from 'lucide-react';
import { cn } from 'cn';

/**
 * Vertical cover of a marketplace catalog card.
 *
 * Recipes may ship their own cover (sibling `cover.png|jpg|jpeg|webp` of the
 * recipe file, base64-cached by the registry sync); this component falls back
 * to a BUILT-IN placeholder, embedded as a small base64 PNG (300x450,
 * posterized mojito gradient) so cards without artwork still read as part of
 * the marketplace.
 */

/** Built-in placeholder cover — data URL, no network, no repo file needed. */
const PLACEHOLDER_COVER =
  'data:image/png;base64,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';

export function MarketplaceCover({
  cover,
  name,
  className,
}: {
  /** Recipe-provided cover (base64 data URL) — null/undefined = placeholder. */
  cover: string | null | undefined;
  /** Recipe name — drives the placeholder monogram. */
  name: string;
  className?: string;
}) {
  const monogram = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      className={cn(
        'relative aspect-[2/3] overflow-hidden rounded-md bg-muted',
        className,
      )}
    >
      <img
        src={cover ?? PLACEHOLDER_COVER}
        alt={name}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {!cover && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/85">
          <Gamepad2 className="size-14 opacity-80" strokeWidth={1.25} />
          <span className="text-3xl font-bold opacity-60">{monogram}</span>
        </div>
      )}
    </div>
  );
}
