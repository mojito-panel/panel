import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { AlertTriangle } from 'lucide-react';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import { listRecipesFn } from '~/server/functions/admin';

/**
 * Picker of the panel's RUNTIME recipes — the single way an app (or a
 * runtime) declares its tool dependencies (`requires`): one row per
 * runtime recipe imported in the panel. A required id whose recipe is
 * missing shows as an orphan row (the install would fail on resolution).
 */
export function RuntimePicker({
  value,
  onChange,
  onBlur,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  onBlur?: () => void;
}) {
  const listRecipes = useServerFn(listRecipesFn);
  const query = useQuery({ queryKey: ['recipes'], queryFn: () => listRecipes() });
  const runtimes = (query.data ?? []).filter((recipe) => recipe.type === 'runtime');

  // Rows: every known runtime, plus required ids without a recipe (orphans)
  const rows = [
    ...runtimes.map((runtime) => ({
      id: runtime.slug,
      name: runtime.name,
      known: true,
    })),
    ...value
      .filter((id) => !runtimes.some((runtime) => runtime.slug === id))
      .map((id) => ({ id, name: id, known: false })),
  ];

  const toggle = (id: string, checked: boolean) => {
    onChange(checked ? [...value, id] : value.filter((v) => v !== id));
  };

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Aucun runtime n'est encore importé — importe une recette runtime (java, steamcmd…)
        pour la sélectionner ici.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
        >
          <div>
            <Label htmlFor={`runtime-${row.id}`}>{row.name}</Label>
            <p className="text-xs text-muted-foreground">
              {row.known ? (
                <>Installé dans le .bin du serveur avant l'application.</>
              ) : (
                <>Recette runtime introuvable — importe-la pour que l'installation fonctionne.</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!row.known && <AlertTriangle className="size-4 text-amber-500" aria-hidden />}
            <Switch
              id={`runtime-${row.id}`}
              checked={value.includes(row.id)}
              onCheckedChange={(checked) => toggle(row.id, checked)}
              onBlur={onBlur}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
