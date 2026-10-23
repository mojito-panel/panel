import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getServerFn,
  reinstallServerFn,
  reloadRecipeFn,
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
  const [askReloadRecipe, setAskReloadRecipe] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [askForceDelete, setAskForceDelete] = useState(false);
  const getServer = useServerFn(getServerFn);
  const reinstall = useServerFn(reinstallServerFn);
  const reloadRecipe = useServerFn(reloadRecipeFn);
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
    mutationFn: (force: boolean) => deleteServer({ data: { serverId, force } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  // Reload recipe = re-snapshot from the CURRENT recipe row, WITHOUT
  // reinstalling — the new definitions (and their values) land on the
  // Variables page; the user reinstalls from this page when ready.
  const reloadMutation = useMutation({
    mutationFn: () => reloadRecipe({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      setAskReloadRecipe(false);
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      toast.success('Recette rechargée', {
        description:
          'Ajuste les variables puis réinstalle le serveur pour appliquer la nouvelle version.',
      });
      if (
        serverCan(query.data?.viewer.permissions ?? [], { 'server.variables': ['read'] })
      ) {
        await navigate({ to: '/servers/$serverId/variables', params: { serverId } });
      }
    },
  });

  const server = query.data;

  // The reload button only appears when the recipe row changed after the
  // server's snapshot — no update, nothing to propagate.
  const recipeUpdatedSinceSnapshot =
    !!server?.recipe.updatedAt &&
    !!server.recipe.syncedAt &&
    new Date(server.recipe.updatedAt) > new Date(server.recipe.syncedAt);

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
            value={server?.resources?.port?.toString() ?? '—'}
          />
          <InfoRow
            label="Mémoire allouée"
            value={
              server?.resources
                ? Number(server.resources.memoryMb) > 0
                  ? `${server.resources.memoryMb} Mo`
                  : 'Illimité'
                : '—'
            }
          />
          <InfoRow
            label="CPU alloué"
            value={
              server?.resources
                ? Number(server.resources.cpuCores) > 0
                  ? `${Number(server.resources.cpuCores)} cœur(s)`
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
            {recipeUpdatedSinceSnapshot && (
              <p className="mt-2 text-yellow-600 dark:text-yellow-400">
                La recette a été modifiée depuis l’installation de ce serveur —
                recharge-la pour mettre à jour ses variables, puis réinstalle
                le serveur pour l’appliquer.
              </p>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              variant="destructive"
              onClick={() => setAskReinstall(true)}
              disabled={reinstallMutation.isPending || reloadMutation.isPending}
            >
              <RefreshCw className={reinstallMutation.isPending ? 'animate-spin' : undefined} />
              {reinstallMutation.isPending ? 'Démarrage…' : 'Réinstaller'}
            </Button>
            {recipeUpdatedSinceSnapshot && (
              <Button
                variant="outline"
                onClick={() => setAskReloadRecipe(true)}
                disabled={reinstallMutation.isPending || reloadMutation.isPending}
              >
                <RefreshCw className={reloadMutation.isPending ? 'animate-spin' : undefined} />
                {reloadMutation.isPending ? 'Rechargement…' : 'Recharger la recette'}
              </Button>
            )}
            {reinstallMutation.isError && (
              <span className="text-sm text-destructive">
                {reinstallMutation.error.message}
              </span>
            )}
            {reloadMutation.isError && (
              <span className="text-sm text-destructive">
                {reloadMutation.error.message}
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
              <>
                <span className="ml-2 text-sm text-destructive">{remove.error.message}</span>
                <Button
                  variant="destructive"
                  onClick={() => setAskForceDelete(true)}
                  disabled={remove.isPending}
                >
                  Supprimer quand même
                </Button>
              </>
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
        open={askReloadRecipe}
        onOpenChange={setAskReloadRecipe}
        onConfirm={() => reloadMutation.mutate()}
        title="Recharger la recette ?"
        description="La version actuelle de la recette remplacera celle utilisée à l’installation. Rien n’est réinstallé à cette étape — ajuste tes variables, puis réinstalle le serveur pour appliquer la nouvelle version."
        confirmLabel="Recharger"
        cancelLabel="Annuler"
        destructive
        pending={reloadMutation.isPending}
      />
      <ConfirmDialog
        open={askDelete}
        onOpenChange={setAskDelete}
        onConfirm={() => {
          remove.mutate(false);
          setAskDelete(false);
        }}
        title={server ? `Supprimer « ${server.name} » ?` : ''}
        description="Le dossier sera effacé."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
      <ConfirmDialog
        open={askForceDelete}
        onOpenChange={setAskForceDelete}
        onConfirm={() => {
          remove.mutate(true);
          setAskForceDelete(false);
        }}
        title={server ? `Supprimer « ${server.name} » sans l’agent ?` : ''}
        description="L’agent est injoignable : le serveur sera supprimé du panel, mais son dossier et son conteneur resteront sur le node — ils seront nettoyés automatiquement dès que le node répondra à nouveau."
        confirmLabel="Supprimer quand même"
        cancelLabel="Annuler"
        destructive
        pending={remove.isPending}
      />
    </div>
  );
}
