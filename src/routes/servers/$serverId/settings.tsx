import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import {
  getServerFn,
  reinstallServerFn,
  deleteServerFn,
} from '~/server/functions/servers';
import { serverCan } from '~/lib/permissions';
import { Button } from '~/components/ui/button';
import { Separator } from '~/components/ui/separator';
import { ErrorState, PageSkeleton } from '~/components/error/error-state';
import { ConfirmDialog } from '~/components/confirm-dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

export const Route = createFileRoute('/servers/$serverId/settings')({
  component: ServerSettingsPage,
});

/** Read-only info row (Pelican "Server Information" fieldset). */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ServerSettingsPage() {
  const { serverId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [askReinstall, setAskReinstall] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const getServer = useServerFn(getServerFn);
  const reinstall = useServerFn(reinstallServerFn);
  const deleteServer = useServerFn(deleteServerFn);

  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId } }),
  });

  const reinstallMutation = useMutation({
    mutationFn: () => reinstall({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      // The reinstall runs in the background — follow it on the console
      await navigate({ to: '/servers/$serverId/console', params: { serverId } });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteServer({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const server = query.data;

  // Per-server grants: reinstall needs server.settings.update, deletion is
  // owner/admin only (non-delegable)
  const viewer = server?.viewer;
  const canReinstall = !!viewer && serverCan(viewer.permissions, { 'server.settings': ['update'] });
  const canDelete = !!viewer && (viewer.isOwner || viewer.isAdmin);

  return (
    <div className="space-y-6">
      {query.isError && (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      )}
      {query.isPending && <PageSkeleton />}

      {/* ─── Server information (Pelican: "Server Information") ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Informations du serveur</CardTitle>
          <CardDescription>
            Détail de la configuration de ce serveur.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <InfoRow label="Nom" value={server?.name ?? '…'} />
          <InfoRow label="Identifiant (UUID)" value={server?.id ?? '…'} />
          <InfoRow label="Recette" value={server?.recipe.name ?? '…'} />
          <InfoRow label="Node" value={server?.node.name ?? '…'} />
          <InfoRow
            label="Port"
            value={server?.allocation?.port?.toString() ?? '—'}
          />
          <InfoRow
            label="Mémoire allouée"
            value={server?.allocation ? `${server.allocation.memoryMb} Mo` : '—'}
          />
          <InfoRow
            label="CPU alloué"
            value={
              server?.allocation
                ? Number(server.allocation.cpuCores) > 0
                  ? `${Number(server.allocation.cpuCores)} cœur(s)`
                  : 'Illimité'
                : '—'
            }
          />
          <InfoRow label="Statut" value={server?.status ?? '…'} />
          <InfoRow
            label="Créé le"
            value={
              server?.createdAt
                ? new Date(server.createdAt).toLocaleString('fr-FR')
                : '…'
            }
          />
        </CardContent>
      </Card>

      {/* ─── Reinstall (Pelican: "Reinstall Server") ─── */}
      {canReinstall && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle>Réinstaller le serveur</CardTitle>
            <CardDescription>
              Réinstaller ce serveur l’arrêtera, puis relancera le script
              d’installation qui l’a configuré initialement.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Certains fichiers peuvent être supprimés ou modifiés pendant
            l’opération — pense à sauvegarder tes données avant de continuer.
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              variant="destructive"
              onClick={() => setAskReinstall(true)}
              disabled={reinstallMutation.isPending}
            >
              <RefreshCw className={reinstallMutation.isPending ? 'animate-spin' : undefined} />
              {reinstallMutation.isPending ? 'Démarrage…' : 'Réinstaller'}
            </Button>
            {reinstallMutation.isError && (
              <span className="text-sm text-destructive">
                {reinstallMutation.error.message}
              </span>
            )}
          </CardFooter>
        </Card>
      )}

      <Separator />

      {/* ─── Danger zone (deletion — already existing feature) ─── */}
      {canDelete && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle>Supprimer le serveur</CardTitle>
            <CardDescription>
              Supprime définitivement le serveur et son dossier sur le node.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="destructive"
              onClick={() => setAskDelete(true)}
              disabled={remove.isPending}
            >
              <Trash2 />
              Supprimer
            </Button>
            {remove.isSuccess && (
              <span className="ml-2 text-sm text-muted-foreground">
                Supprimé — retour à la liste…
              </span>
            )}
            {remove.isError && (
              <span className="ml-2 text-sm text-destructive">{remove.error.message}</span>
            )}
          </CardFooter>
        </Card>
      )}
      <ConfirmDialog
        open={askReinstall}
        onOpenChange={setAskReinstall}
        onConfirm={() => {
          reinstallMutation.mutate();
          setAskReinstall(false);
        }}
        title="Es-tu sûr de vouloir réinstaller le serveur ?"
        description="Certains fichiers peuvent être supprimés ou modifiés pendant l’opération — pense à sauvegarder tes données."
        confirmLabel="Réinstaller"
        cancelLabel="Annuler"
        destructive
        pending={reinstallMutation.isPending}
      />
      <ConfirmDialog
        open={askDelete}
        onOpenChange={setAskDelete}
        onConfirm={() => {
          remove.mutate();
          setAskDelete(false);
        }}
        title={server ? `Supprimer « ${server.name} » ?` : ''}
        description="Le dossier sera effacé."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}
