import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { HardDriveDownload } from 'lucide-react';
import { DataTable } from '~/components/data-table/data-table';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { serverBackupsList, type ServerBackupRow } from '~/lists/backups';
import { getServerFn } from '~/server/functions/servers';
import {
  listBackupsFn,
  createBackupFn,
  restoreBackupFn,
  deleteBackupFn,
  getBackupDownloadUrlFn,
} from '~/server/functions/backups';
import { serverCan } from '~/lib/permissions';
import { createBackupFormSchema } from '~/validators/server';

/**
 * /servers/$serverId/backups — sauvegardes (création, restauration,
 * téléchargement, suppression). The list definition (`~/lists/backups`) holds
 * the columns AND the query it accepts; filtering, sorting and pagination run
 * in the database, the state lives in the URL search params.
 */
export const Route = createFileRoute('/servers/$serverId/backups')({
  // Same schema as the server function: the route validates the URL, the
  // function validates the payload — one definition, no drift.
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    serverBackupsList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(serverBackupsList.defaultSearch)] },
  component: ServerBackupsPage,
});

/** Backup statuses still running on the agent — the page polls while any is present. */
const ACTIVE_BACKUP_STATUSES: ServerBackupRow['status'][] = ['pending', 'running', 'restoring'];

function ServerBackupsPage() {
  const { serverId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();

  const getServer = useServerFn(getServerFn);
  const listBackups = useServerFn(listBackupsFn);
  const createBackup = useServerFn(createBackupFn);
  const restoreBackup = useServerFn(restoreBackupFn);
  const deleteBackup = useServerFn(deleteBackupFn);
  const getDownloadUrl = useServerFn(getBackupDownloadUrlFn);

  // Shared server query (cached) — viewer grants gate the page controls
  const serverQuery = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });
  const permissions = serverQuery.data?.viewer?.permissions ?? [];
  const includes = serverQuery.data?.recipe?.backup?.include;

  const canCreate = serverCan(permissions, { 'server.backups': ['create'] });
  const canRestore = serverCan(permissions, { 'server.backups': ['restore'] });
  const canDelete = serverCan(permissions, { 'server.backups': ['delete'] });
  const canRead = serverCan(permissions, { 'server.backups': ['read'] });

  // The list syncs in-flight statuses with the agent — poll while the CURRENT PAGE has an active row
  const query = useQuery({
    queryKey: ['server-backups', serverId, search],
    queryFn: () => listBackups({ data: { ...search, serverId } }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const statuses = query.state.data?.rows?.map((backup) => backup.status) ?? [];
      return statuses.some((status) => ACTIVE_BACKUP_STATUSES.includes(status)) ? 2000 : false;
    },
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['server-backups', serverId] });
  };

  const create = useMutation({
    mutationFn: (input: { name?: string }) =>
      createBackup({ data: { serverId, name: input.name || undefined } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Sauvegarde démarrée');
    },
    onError: (error) => toast.error(error.message),
  });

  const restore = useMutation({
    mutationFn: (input: { backupId: string; truncate: boolean }) =>
      restoreBackup({
        data: { serverId, backupId: input.backupId, truncate: input.truncate },
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Restauration démarrée — le serveur reste arrêté');
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (input: { backupId: string }) =>
      deleteBackup({ data: { serverId, backupId: input.backupId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Sauvegarde supprimée');
    },
    onError: (error) => toast.error(error.message),
  });

  const download = useMutation({
    mutationFn: (input: { backupId: string }) =>
      getDownloadUrl({ data: { serverId, backupId: input.backupId } }),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (error) => toast.error(error.message),
  });

  // "Create a backup" form — optional name, contents come from the recipe
  const form = useForm({
    defaultValues: { name: '' },
    validators: { onChange: createBackupFormSchema },
    onSubmit: ({ value }) => {
      create.mutate({ name: value.name || undefined });
    },
  });

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const onDownload = (backup: ServerBackupRow) => {
    download.mutate({ backupId: backup.id });
  };

  const onRestore = (backup: ServerBackupRow, truncate: boolean) => {
    const confirmed = confirm(
      truncate
        ? `Restaurer « ${backup.name} » en REMPLAÇANT tout le dossier du serveur ? Tout fichier absent de l’archive sera DÉFINITIVEMENT PERDU.`
        : `Restaurer « ${backup.name} » ? Les fichiers de l’archive écrasent les fichiers actuels ; le serveur sera arrêté.`,
    );
    if (confirmed) restore.mutate({ backupId: backup.id, truncate });
  };

  const onDelete = (backup: ServerBackupRow) => {
    if (confirm(`Supprimer « ${backup.name} » ?`)) {
      remove.mutate({ backupId: backup.id });
    }
  };

  // Only deny once the viewer grants are known: while the server query is in
  // flight the table renders its skeleton (also keeps SSR HTML usable).
  if (serverQuery.isSuccess && !canRead) {
    return (
      <p className="text-sm text-muted-foreground">
        Tu n’as pas la permission de gérer les sauvegardes de ce serveur.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Create a backup ─── */}
      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Créer une sauvegarde</CardTitle>
            <CardDescription>
              {includes && includes.length > 0
                ? `Contenu (recette) : ${includes.join(', ')} — le dossier .bin de l'agent est toujours exclu.`
                : 'Aucun contenu déclaré par la recette : tout le serveur est sauvegardé (sauf le dossier .bin de l’agent).'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="max-w-sm space-y-4"
            >
              <form.Field name="name">
                {(field) => (
                  <div className="space-y-2">
                    <Input
                      placeholder="Nom (optionnel)"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">
                        {String(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
              <form.Subscribe selector={(s) => [s.isSubmitting, create.isPending]}>
                {([isSubmitting, pending]) => (
                  <Button type="submit" disabled={isSubmitting || pending}>
                    <HardDriveDownload />
                    {pending ? 'Démarrage…' : 'Sauvegarder'}
                  </Button>
                )}
              </form.Subscribe>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ─── Backup list ─── */}
      <DataTable
        list={serverBackupsList}
        rows={query.data?.rows ?? []}
        rowCount={query.data?.rowCount ?? 0}
        search={search}
        onSearchChange={onSearchChange}
        isPending={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        emptyMessage="Aucune sauvegarde pour l’instant."
        rowContext={{
          canRestore,
          canDelete,
          downloading: download.isPending,
          restoring: restore.isPending,
          deleting: remove.isPending,
          onDownload,
          onRestore,
          onDelete,
        }}
      />
    </div>
  );
}
