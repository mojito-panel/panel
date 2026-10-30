import { Badge } from '~/components/ui/badge';
import type { RecipeSourceStatus, RegistryEntryStatus } from '~/lib/recipe-source';

/**
 * Shared badge for every recipe-source status (recipes list, marketplace
 * catalog) — one mapping status → label/variant, so the same state reads
 * the same everywhere.
 */

const STATUS_META: Record<
  RecipeSourceStatus | RegistryEntryStatus,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    className?: string;
  }
> = {
  local: { label: 'Locale', variant: 'outline' },
  unchecked: { label: 'Non vérifiée', variant: 'outline' },
  upstream_gone: { label: 'Supprimée en amont', variant: 'destructive' },
  modified_locally: {
    label: 'Modifiée localement',
    variant: 'outline',
    // Warning tone — an update would overwrite these local changes.
    className:
      'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  update_available: { label: 'Mise à jour disponible', variant: 'default' },
  up_to_date: { label: 'À jour', variant: 'secondary' },
  not_imported: { label: 'Non importée', variant: 'outline' },
  invalid: { label: 'Invalide', variant: 'destructive' },
};

export function RecipeSourceStatusBadge({
  status,
}: {
  status: RecipeSourceStatus | RegistryEntryStatus;
}) {
  const meta = STATUS_META[status];
  return (
    <Badge variant={meta.variant} className={meta.className} title={meta.label}>
      {meta.label}
    </Badge>
  );
}
