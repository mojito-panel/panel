import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { z } from 'zod';
import { ArrowLeft, FileJson, FolderGit2, GitBranch, RefreshCw, Search } from 'lucide-react';
import {
  listRegistryEntriesFn,
  syncRegistryFn,
  importRegistryEntryFn,
  getRegistryEntryFn,
} from '~/server/functions/marketplace';
import { ConfirmDialog } from '~/components/confirm-dialog';
import { CoverImage } from '~/components/cover-image';
import { RecipeSourceStatusBadge } from '~/components/recipe-source-status';
import { TimeAgo } from '~/components/time-ago';
import { ErrorState } from '~/components/error/error-state';
import { useAuth } from '~/contexts/use-auth';
import { hasPermissions } from '~/lib/permissions';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import type { RegistryCatalogEntry, RegistryEntryStatus } from '~/lib/recipe-source';

/**
 * Search params of the catalog — plain string params (this page is a card
 * grid, not a shared list, so there is no list query schema): `q` filters by
 * name/slug/path, `status` by update status. Both live in the URL so a
 * filtered view deep-links.
 */
const catalogSearchSchema = z.object({
  q: z.string().trim().max(128).optional().catch(undefined),
  status: z
    .enum(['not_imported', 'up_to_date', 'update_available', 'modified_locally', 'invalid', 'upstream_gone'])
    .optional()
    .catch(undefined),
});

type CatalogSearch = z.infer<typeof catalogSearchSchema>;

const STATUS_OPTIONS: Array<{ value: RegistryEntryStatus; label: string }> = [
  { value: 'not_imported', label: 'Non importée' },
  { value: 'up_to_date', label: 'À jour' },
  { value: 'update_available', label: 'Mise à jour disponible' },
  { value: 'modified_locally', label: 'Modifiée localement' },
  { value: 'invalid', label: 'Invalide' },
  { value: 'upstream_gone', label: 'Supprimée en amont' },
];

const IMPORTABLE_STATUSES = new Set<RegistryEntryStatus>([
  'not_imported',
  'up_to_date',
  'update_available',
  'modified_locally',
]);

export const Route = createFileRoute('/admin/marketplace/$registryId/')({
  validateSearch: (search: Record<string, unknown>): CatalogSearch =>
    catalogSearchSchema.parse(search),
  component: RegistryCatalogPage,
});

/**
 * /admin/marketplace/$registryId — the catalog of one registry, Steam-style:
 * a responsive grid of vertical cover cards, one click to import or update.
 * The covers come from the registry's cached catalog (base64 data URLs, read
 * from each recipe's sibling cover file at sync time); recipes without
 * artwork show the built-in placeholder. Imports are one by one — the
 * content comes from the cache, so importing never clones.
 */
function RegistryCatalogPage() {
  const { registryId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  // Panel-level grants — the server functions enforce the same ones
  // (sync = update, import = create)
  const canUpdate = hasPermissions(permissions, { 'panel.recipes': ['update'] });
  const canImport = hasPermissions(permissions, { 'panel.recipes': ['create'] });

  const listEntries = useServerFn(listRegistryEntriesFn);
  const syncRegistry = useServerFn(syncRegistryFn);
  const importEntry = useServerFn(importRegistryEntryFn);
  const getEntry = useServerFn(getRegistryEntryFn);

  const query = useQuery({
    queryKey: ['registry-entries', registryId],
    queryFn: () => listEntries({ data: { registryId } }),
    // Poll while the first sync has not landed yet.
    refetchInterval: (current) => (current.state.data?.registry.neverSynced ? 4000 : false),
  });

  const invalidateCatalog = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['registry-entries', registryId] }),
      queryClient.invalidateQueries({ queryKey: ['admin-registries'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-recipes'] }),
    ]);
  };

  const sync = useMutation({
    mutationFn: () => syncRegistry({ data: { registryId } }),
    onSuccess: async () => {
      await invalidateCatalog();
      toast.success('Synchronisation lancée — le catalogue se rafraîchit en arrière-plan');
    },
    onError: (error) => toast.error(error.message),
  });

  const runImport = useMutation({
    mutationFn: (row: RegistryCatalogEntry) =>
      importEntry({ data: { registryId, path: row.path } }),
    onSuccess: async (result) => {
      await invalidateCatalog();
      toast.success(
        `Recette « ${result.name} » ${result.created ? 'importée' : 'mise à jour'}` +
          (result.imported.length > 0
            ? ` — ${result.imported.length} dépendance(s) importée(s)`
            : ''),
      );
      for (const dependency of result.imported) {
        toast.success(
          `Dépendance « ${dependency.name} » ${dependency.created ? 'importée' : 'à jour'}`,
        );
      }
      for (const missing of result.missing) {
        toast.warning(`Dépendance « ${missing} » introuvable dans ce registre`);
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const setSearch = (patch: Partial<CatalogSearch>) =>
    navigate({ search: (previous: CatalogSearch) => ({ ...previous, ...patch }) });

  // An update overwrites local edits — the admin confirms first.
  const [rowToConfirm, setRowToConfirm] = useState<RegistryCatalogEntry | null>(null);
  const [rowToView, setRowToView] = useState<RegistryCatalogEntry | null>(null);

  // The cached file CONTENT is not in the grid (heavy) — the view dialog
  // fetches ONE entry on demand.
  const viewQuery = useQuery({
    queryKey: ['registry-entry', registryId, rowToView?.path],
    queryFn: () => getEntry({ data: { registryId, path: rowToView?.path ?? '' } }),
    enabled: rowToView !== null,
  });

  const onImport = (row: RegistryCatalogEntry) => {
    if (row.status === 'modified_locally') {
      setRowToConfirm(row);
      return;
    }
    runImport.mutate(row);
  };

  const registry = query.data?.registry;
  const entries = query.data?.entries ?? [];
  const needle = search.q?.toLowerCase();
  const visible = entries.filter((row) => {
    if (search.status && row.status !== search.status) return false;
    if (needle) {
      const haystack = `${row.name ?? ''} ${row.slug ?? ''} ${row.path}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link
              to="/admin/marketplace"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Retour aux registres"
            >
              <ArrowLeft />
            </Link>
            {registry?.name ?? '…'}
          </CardTitle>
          <CardDescription>
            {registry ? (
              <>
                {registry.description && (
                  <span className="mb-1 block">{registry.description}</span>
                )}
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex items-center gap-1">
                    <FolderGit2 className="size-3.5 shrink-0" />
                    <a
                      href={registry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-foreground"
                    >
                      {registry.url}
                    </a>
                  </span>
                  {(registry.branch || registry.branchName) && (
                    <>
                      <span className="text-muted-foreground" aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1">
                        <GitBranch className="size-3.5 shrink-0" />
                        {registry.branch || registry.branchName}
                      </span>
                    </>
                  )}
                  {(registry.author || registry.license) && (
                    <>
                      <span className="text-muted-foreground" aria-hidden>·</span>
                      {registry.author && <span>{registry.author}</span>}
                      {registry.author && registry.license && (
                        <span className="text-muted-foreground" aria-hidden>·</span>
                      )}
                      {registry.license && <Badge variant="outline">{registry.license}</Badge>}
                    </>
                  )}
                  {registry.lastSyncedAt && (
                    <>
                      <span className="text-muted-foreground" aria-hidden>·</span>
                      <TimeAgo
                        date={registry.lastSyncedAt}
                        prefix={<RefreshCw className="size-3.5 shrink-0" />}
                      />
                    </>
                  )}
                </span>
              </>
            ) : (
              'Catalogue du registre'
            )}
            {registry?.neverSynced && ' · première synchronisation en cours…'}
          </CardDescription>
          <CardAction>
            {canUpdate && (
              <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw />
                Synchroniser
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent>
          {registry?.lastError && (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
              Dernière synchronisation en échec : {registry.lastError}
            </p>
          )}

          {/* ─── Filter bar — plain URL params (this page is a grid, not a list) ─── */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search.q ?? ''}
                onChange={(e) => setSearch({ q: e.target.value })}
                placeholder="Rechercher une recette…"
                className="w-64 pl-8"
              />
            </div>
            <Select
              value={search.status ?? null}
              onValueChange={(next) => setSearch({ status: next ?? undefined })}
            >
              <SelectTrigger className="w-56">
                {/* base-ui only resolves an item's label once its popup opened —
                    a closed trigger shows the raw id, so the label is resolved here. */}
                <SelectValue placeholder="Tous les statuts">
                  {(current: string | null) =>
                    !current
                      ? 'Tous les statuts'
                      : (STATUS_OPTIONS.find((option) => option.value === current)?.label ??
                        current)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground">
              {visible.length} / {entries.length} recette(s)
            </span>
          </div>

          {/* ─── Catalog — vertical cover cards ─── */}
          {query.isPending ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="aspect-[2/3] animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : query.isError ? (
            // A failed load is NEVER an empty catalog — offer the retry.
            <ErrorState message={query.error.message} onRetry={() => query.refetch()} bare />
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {registry?.neverSynced
                ? 'Synchronisation en cours…'
                : entries.length === 0
                  ? 'Aucune recette (recipe-*.json) trouvée dans ce dépôt.'
                  : 'Aucune recette ne correspond au filtre.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {visible.map((row) => (
                <div
                  key={row.path}
                  className={
                    row.status === 'upstream_gone'
                      ? 'flex flex-col overflow-hidden rounded-lg border opacity-60'
                      : 'flex flex-col overflow-hidden rounded-lg border transition-shadow hover:shadow-md'
                  }
                >
                  <CoverImage
                    cover={row.cover}
                    seed={`${registryId}:${row.path}`}
                    className="rounded-b-none border-b"
                  />
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium leading-tight" title={row.name ?? row.path}>
                          {row.name ?? row.path}
                        </p>
                        <p className="truncate text-xs text-muted-foreground" title={row.path}>
                          {row.slug ?? row.path}
                        </p>
                      </div>
                      {row.type === 'runtime' && (
                        <Badge
                          variant="secondary"
                          title="Recette d’exécution requise par d’autres recettes"
                        >
                          Runtime
                        </Badge>
                      )}
                    </div>
                    {row.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground" title={row.description}>
                        {row.description}
                      </p>
                    )}
                    <RecipeSourceStatusBadge status={row.status} />
                    {row.error && (
                      <p className="line-clamp-2 text-xs text-destructive" title={row.error}>
                        {row.error}
                      </p>
                    )}
                    <div className="mt-auto flex items-center gap-1 pt-1">
                      {IMPORTABLE_STATUSES.has(row.status) ? (
                        canImport ? (
                          <Button
                            size="sm"
                            className="flex-1"
                            variant={row.status === 'not_imported' ? 'default' : 'outline'}
                            disabled={runImport.isPending}
                            onClick={() => onImport(row)}
                          >
                            {row.status === 'not_imported' ? (
                              'Importer'
                            ) : (
                              <>
                                <RefreshCw />
                                Mettre à jour
                              </>
                            )}
                          </Button>
                        ) : (
                          <span className="flex-1" />
                        )
                      ) : (
                        <span className="flex-1" />
                      )}
                      {row.status !== 'upstream_gone' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Voir le JSON"
                          onClick={() => setRowToView(row)}
                        >
                          <FileJson />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* A source update overwrites local edits — the admin confirms first. */}
      <ConfirmDialog
        open={rowToConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setRowToConfirm(null);
        }}
        onConfirm={async () => {
          if (!rowToConfirm) return;
          try {
            await runImport.mutateAsync(rowToConfirm);
            setRowToConfirm(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
        }}
        title={`« ${rowToConfirm?.name} » a été modifiée localement`}
        description="Mettre à jour depuis le registre écrasera les modifications locales — la recette redeviendra identique au fichier du dépôt."
        confirmLabel="Mettre à jour quand même"
        cancelLabel="Annuler"
        pending={runImport.isPending}
      />

      {/* Vet a recipe before importing — the raw file, read-only. */}
      <Dialog
        open={rowToView !== null}
        onOpenChange={(open) => {
          if (!open) setRowToView(null);
        }}
      >
        {/* sm: variant required — DialogContent's sm:max-w-md would beat a
            bare max-w-* and cap the dialog at 448px. */}
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{rowToView?.path}</DialogTitle>
            <DialogDescription>
              Fichier du registre, en lecture seule — importer pour l’ajouter au panel.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {viewQuery.isPending
              ? 'Chargement…'
              : (viewQuery.error
                  ? viewQuery.error.message
                  : (viewQuery.data?.content ?? ''))}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
