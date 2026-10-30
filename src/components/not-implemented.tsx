import { Construction } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

/**
 * Placeholder for a planned-but-not-yet-implemented page (roadmap view —
 * mirrors the Pelican panel menus so the gap is visible at a glance).
 */
export function NotImplemented({
  title,
  description,
  pelican,
}: {
  title: string;
  /** What the page will do once implemented. */
  description: string;
  /** Pelican menu equivalent (feature-parity reference). */
  pelican?: string;
}) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <Construction className="size-5" />
          </span>
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Pas encore implémenté</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-2 text-sm">
        <p>{description}</p>
        {pelican && (
          <p className="text-xs">
            Équivalent Pelican : <span className="font-medium">{pelican}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
