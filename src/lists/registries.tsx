import { Link } from '@tanstack/react-router';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { defineList, field } from '~/lists/define';

/**
 * /admin/marketplace — the registries (public git repositories of recipes).
 *
 * The full set arrives with one query (a panel manages a handful of
 * registries), so the list runs in `client` mode: filtering and sorting
 * happen in the browser with the same toolbar as every other list.
 */

/** Row of the registries list (what the server function returns). */
export interface AdminRegistryRow {
  id: string;
  name: string;
  url: string;
  /** Tracked branch — '' = the repository's default. */
  branch: string;
  /** Branch name resolved by the last sync (feeds the recipe source URLs). */
  branchName: string;
  /** True until the first sync lands — the page polls meanwhile. */
  neverSynced: boolean;
  lastSyncedAt: Date | null;
  lastError: string | null;
  entryCount: number;
  /** Catalog status counts, matched against the recipes table. */
  notImported: number;
  upToDate: number;
  updateAvailable: number;
  modifiedLocally: number;
  invalid: number;
  upstreamGone: number;
}

/** Row actions of the registries list, supplied by the page. */
export interface AdminRegistriesContext {
  syncing: boolean;
  deleting: boolean;
  onSync: (registry: AdminRegistryRow) => void;
  onDelete: (registry: AdminRegistryRow) => void;
}

export const adminRegistriesList = defineList<AdminRegistryRow, AdminRegistriesContext>({
  name: 'admin-registries',
  alias: 'g',
  mode: 'client',
  defaultSort: { column: 'name', desc: false },
  columns: {
    name: {
      header: 'Registre',
      sort: true,
      sortFn: 'text',
      filter: { control: 'text', target: field('name') },
      cell: (registry) => (
        <div>
          <Link
            to="/admin/marketplace/$registryId"
            params={{ registryId: registry.id }}
            className="font-medium hover:underline"
          >
            {registry.name}
          </Link>
          <p
            className="max-w-xs truncate text-xs text-muted-foreground"
            title={registry.url}
          >
            {registry.url}
            {registry.branch ? ` · ${registry.branch}` : ''}
          </p>
        </div>
      ),
    },
    catalog: {
      header: 'Catalogue',
      cell: (registry) =>
        registry.neverSynced ? (
          <span className="text-xs text-muted-foreground">Synchronisation…</span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="text-muted-foreground">{registry.entryCount} recette(s)</span>
            {registry.updateAvailable > 0 && (
              <span className="font-medium text-primary">
                {registry.updateAvailable} à mettre à jour
              </span>
            )}
            {registry.modifiedLocally > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {registry.modifiedLocally} modifiée(s)
              </span>
            )}
            {registry.upstreamGone > 0 && (
              <span className="text-destructive">{registry.upstreamGone} supprimée(s)</span>
            )}
            {registry.invalid > 0 && (
              <span className="text-destructive">{registry.invalid} invalide(s)</span>
            )}
          </div>
        ),
    },
    lastSyncedAt: {
      header: 'Synchronisée le',
      sort: true,
      sortFn: 'datetime',
      cell: (registry) => {
        if (registry.neverSynced) {
          return <span className="text-muted-foreground">—</span>;
        }
        return (
          <div>
            <span className="text-muted-foreground">
              {registry.lastSyncedAt?.toLocaleString('fr-FR')}
            </span>
            {registry.lastError && (
              <p className="max-w-xs truncate text-xs text-destructive" title={registry.lastError}>
                {registry.lastError}
              </p>
            )}
          </div>
        );
      },
    },
    actions: {
      header: '',
      pinned: true,
      cell: (registry, context) =>
        // A picker renders this list without a page — nothing to act on.
        context === undefined ? null : (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            title="Synchroniser maintenant"
            disabled={context.syncing}
            onClick={() => context.onSync(registry)}
          >
            <RefreshCw />
            Synchroniser
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={context.deleting}
            onClick={() => context.onDelete(registry)}
          >
            <Trash2 />
            Supprimer
          </Button>
        </div>
      ),
    },
  },
});
