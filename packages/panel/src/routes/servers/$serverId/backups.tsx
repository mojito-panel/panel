import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { Download, HardDriveDownload, RotateCcw, Trash2 } from 'lucide-react';
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
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

/** /servers/$serverId/backups — sauvegardes (création, restauration, téléchargement, suppression). */
export const Route = createFileRoute('/servers/$serverId/backups')({
  component: ServerBackupsPage,
});

interface BackupDto {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'restoring' | 'completed' | 'failed';
  sizeBytes: number;
  checksum: string | null;
  error: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

const STATUS_LABELS: Record<BackupDto['status'], string> = {
  pending: 'En attente',
  running: 'En cours…',
  restoring: 'Restauration…',
  completed: 'Terminée',
  failed: 'Échouée',
};

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('fr-FR');
}

/** Small status chip (backups have their own lifecycle, not StatusBadge). */
function BackupStatusChip({ status }: { status: BackupDto['status'] }) {
  const cls =
    status === 'completed'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : status === 'failed'
        ? 'bg-destructive/15 text-destructive'
        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function ServerBackupsPage() {
  const { serverId } = Route.useParams();
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
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
  });
  const permissions = serverQuery.data?.viewer?.permissions ?? [];
  const includes = serverQuery.data?.recipe?.backup?.include;

  const canCreate = serverCan(permissions, { 'server.backups': ['create'] });
  const canRestore = serverCan(permissions, { 'server.backups': ['restore'] });
  const canDelete = serverCan(permissions, { 'server.backups': ['delete'] });

  // The list syncs in-flight statuses with the agent — poll while active
  const query = useQuery({
    queryKey: ['server-backups', serverId],
    queryFn: () => listBackups({ data: { serverId } }),
    refetchInterval: (query) => {
      const statuses = query.state.data?.map((b: BackupDto) => b.status) ?? [];
      return statuses.some((s: string) => ['pending', 'running', 'restoring'].includes(s))
        ? 2000
        : false;
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

  if (!serverCan(permissions, { 'server.backups': ['read'] })) {
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <CardContent>
              <form.Field name="name">
                {(field) => (
                  <div className="max-w-sm space-y-2">
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
            </CardContent>
            <CardFooter>
              <form.Subscribe selector={(s) => [s.isSubmitting, create.isPending]}>
                {([isSubmitting, pending]) => (
                  <Button type="submit" disabled={isSubmitting || pending}>
                    <HardDriveDownload />
                    {pending ? 'Démarrage…' : 'Sauvegarder'}
                  </Button>
                )}
              </form.Subscribe>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* ─── Backup list ─── */}
      <div className="space-y-4">
        {query.isPending && (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
        {query.isError && (
          <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
        )}
        {query.data?.map((backup) => (
          <Card key={backup.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {backup.name}
                    <BackupStatusChip status={backup.status} />
                  </CardTitle>
                  <CardDescription>
                    {formatSize(backup.sizeBytes)} — créée le {formatDate(backup.createdAt)}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={backup.status !== 'completed' || download.isPending}
                    onClick={() => download.mutate({ backupId: backup.id })}
                  >
                    <Download />
                    Télécharger
                  </Button>
                  {canRestore && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={backup.status !== 'completed' || restore.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Restaurer « ${backup.name} » ? Les fichiers de l’archive écrasent les fichiers actuels ; le serveur sera arrêté.`,
                            )
                          ) {
                            restore.mutate({ backupId: backup.id, truncate: false });
                          }
                        }}
                      >
                        <RotateCcw />
                        Restaurer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={backup.status !== 'completed' || restore.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Restaurer « ${backup.name} » en REMPLAÇANT tout le dossier du serveur ? Tout fichier absent de l’archive sera DÉFINITIVEMENT PERDU.`,
                            )
                          ) {
                            restore.mutate({ backupId: backup.id, truncate: true });
                          }
                        }}
                      >
                        <RotateCcw />
                        Restaurer et remplacer
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`Supprimer « ${backup.name} » ?`)) {
                          remove.mutate({ backupId: backup.id });
                        }
                      }}
                    >
                      <Trash2 />
                      Supprimer
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {backup.checksum && (
                <p className="truncate font-mono text-xs text-muted-foreground" title={backup.checksum}>
                  sha256 : {backup.checksum}
                </p>
              )}
              {backup.error && (
                <p className="text-sm text-destructive">{backup.error}</p>
              )}
            </CardContent>
          </Card>
        ))}
        {!query.isPending && (query.data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">
            Aucune sauvegarde pour l’instant.
          </p>
        )}
      </div>
    </div>
  );
}
