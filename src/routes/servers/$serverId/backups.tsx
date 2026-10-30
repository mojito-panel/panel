import { useForm } from '@tanstack/react-form';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { HardDriveDownload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '~/components/confirm-dialog';
import { DataTable } from '~/components/data-table/data-table';
import { triggerDownload } from '~/components/download';
import { Button } from '~/components/ui/button';
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
import { Input } from '~/components/ui/input';
import { hasServerPermissions } from '~/lib/permissions';
import { serverBackupsList, type ServerBackupRow } from '~/lists/backups';
import { mergeQuery, type ListQuery } from '~/lists/define';
import {
  listBackupsFn,
  createBackupFn,
  restoreBackupFn,
  deleteBackupFn,
  getBackupDownloadUrlFn,
} from '~/server/functions/backups';
import { getServerFn } from '~/server/functions/servers';
import { createBackupFormSchema } from '~/validators/server';

/**
 * /servers/$serverId/backups — backups (create, restore, download,
 * delete). The list definition (`~/lists/backups`) holds
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
  // Pending restore: which backup and whether it truncates the folder.
  const [toRestore, setToRestore] = useState<{ backup: ServerBackupRow; truncate: boolean } | null>(
    null,
  );
  const [toDelete, setToDelete] = useState<ServerBackupRow | null>(null);
  // Create dialog, opened from the list card's action button.
  const [createOpen, setCreateOpen] = useState(false);

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

  const canCreate = hasServerPermissions(permissions, { 'server.backups': ['create'] });
  const canRestore = hasServerPermissions(permissions, { 'server.backups': ['restore'] });
  const canDelete = hasServerPermissions(permissions, { 'server.backups': ['delete'] });
  const canRead = hasServerPermissions(permissions, { 'server.backups': ['read'] });

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
    // Sidebar badge (backups used / limit) lives on the shared detail query
    await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
  };

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
      // Synthetic <a download> click (see components/download.ts) — the
      // browser streams the archive straight from the agent.
      triggerDownload(result.url, result.url.split('/').pop() ?? 'sauvegarde');
    },
    onError: (error) => toast.error(error.message),
  });

  // Search updates write the WHOLE validated query back (reducer form would
  // require the raw params type): the page resets below are part of the patch.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  const onDownload = (backup: ServerBackupRow) => {
    download.mutate({ backupId: backup.id });
  };

  const onRestore = (backup: ServerBackupRow, truncate: boolean) => {
    setToRestore({ backup, truncate });
  };

  // Only deny once the viewer grants are known: while the server query is in
  // flight the table renders its skeleton (also keeps SSR HTML usable).
  if (serverQuery.isSuccess && !canRead) {
    return (
      <p className="text-muted-foreground text-sm">
        Tu n’as pas la permission de gérer les sauvegardes de ce serveur.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Backup list — create lives in the card's action, like every list page ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Sauvegardes</CardTitle>
          <CardDescription>
            {includes && includes.length > 0
              ? `Contenu (recette) : ${includes.join(', ')} — le dossier .bin de l'agent est toujours exclu.`
              : 'Aucun contenu déclaré par la recette : tout le serveur est sauvegardé (sauf le dossier .bin de l’agent).'}
          </CardDescription>
          {canCreate && (
            <CardAction>
              <Button onClick={() => setCreateOpen(true)}>
                <HardDriveDownload />
                Sauvegarder
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
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
              onDelete: setToDelete,
            }}
          />
        </CardContent>
      </Card>

      {/* ─── Create a backup (dialog opened from the list card's action button) ─── */}
      {canCreate && (
        <CreateBackupDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          createBackup={createBackup}
          serverId={serverId}
          onCreated={invalidate}
        />
      )}

      <ConfirmDialog
        open={toRestore !== null}
        onOpenChange={(open) => !open && setToRestore(null)}
        onConfirm={async () => {
          if (!toRestore) return;
          try {
            await restore.mutateAsync({
              backupId: toRestore.backup.id,
              truncate: toRestore.truncate,
            });
            setToRestore(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
        }}
        title={
          toRestore?.truncate
            ? `Restaurer « ${toRestore.backup.name} » en REMPLAÇANT tout le dossier du serveur ?`
            : `Restaurer « ${toRestore?.backup.name ?? ''} » ?`
        }
        description={
          toRestore?.truncate
            ? 'Tout fichier absent de l’archive sera DÉFINITIVEMENT PERDU.'
            : 'Les fichiers de l’archive écrasent les fichiers actuels ; le serveur sera arrêté.'
        }
        confirmLabel="Restaurer"
        cancelLabel="Annuler"
        destructive
        pending={restore.isPending}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await remove.mutateAsync({ backupId: toDelete.id });
            setToDelete(null);
          } catch {
            // Toasted by the mutation — keep the dialog open.
          }
        }}
        title={toDelete ? `Supprimer « ${toDelete.name} » ?` : ''}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}

/** "Create a backup" dialog, opened from the list card's action button. */
function CreateBackupDialog({
  open,
  onOpenChange,
  createBackup,
  serverId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createBackup: (args: { data: { serverId: string; name?: string } }) => Promise<unknown>;
  serverId: string;
  onCreated: () => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { name: '' },
    validators: { onChange: createBackupFormSchema },
    onSubmit: ({ value }) => {
      create.mutate({ name: value.name || undefined });
    },
  });

  const create = useMutation({
    mutationFn: (input: { name?: string }) =>
      createBackup({ data: { serverId, name: input.name } }),
    onSuccess: async () => {
      await onCreated();
      form.reset();
      onOpenChange(false);
      toast.success('Sauvegarde démarrée');
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Créer une sauvegarde</DialogTitle>
          <DialogDescription>
            Le nom est optionnel — sans nom, la sauvegarde porte la date du jour. Le contenu de
            l’archive est déclaré par la recette du serveur.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
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
                  <p className="text-destructive text-sm">{field.state.meta.errors[0]?.message}</p>
                )}
              </div>
            )}
          </form.Field>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <form.Subscribe selector={(s) => [s.isSubmitting, create.isPending]}>
              {([isSubmitting, pending]) => (
                <Button type="submit" disabled={isSubmitting || pending}>
                  <HardDriveDownload />
                  {pending ? 'Démarrage…' : 'Sauvegarder'}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
