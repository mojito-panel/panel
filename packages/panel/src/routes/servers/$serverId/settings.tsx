import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  getServerFn,
  reinstallServerFn,
  deleteServerFn,
} from '~/server/functions/servers';
import { Button } from '~/components/ui/button';
import { Separator } from '~/components/ui/separator';
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
  const queryClient = useQueryClient();
  const getServer = useServerFn(getServerFn);
  const reinstall = useServerFn(reinstallServerFn);
  const deleteServer = useServerFn(deleteServerFn);

  const query = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => getServer({ data: { serverId, after: 0 } }),
  });

  const reinstallMutation = useMutation({
    mutationFn: () => reinstall({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteServer({ data: { serverId, after: 0 } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const server = query.data;

  const confirmReinstall = () => {
    // Pelican wording: some files may be deleted/modified — explicit confirm
    if (
      !confirm(
        'Es-tu sûr de vouloir réinstaller le serveur ? Certains fichiers peuvent être supprimés ou modifiés pendant l’opération — pense à sauvegarder tes données.',
      )
    ) {
      return;
    }
    reinstallMutation.mutate();
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      {query.isError && (
        <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
      )}

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
          <InfoRow label="Plugin" value={server?.plugin.name ?? '…'} />
          <InfoRow label="Node" value={server?.node.name ?? '…'} />
          <InfoRow
            label="Port"
            value={server?.allocation?.port?.toString() ?? '—'}
          />
          <InfoRow
            label="Mémoire allouée"
            value={server?.allocation ? `${server.allocation.memoryMb} Mo` : '—'}
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
            onClick={confirmReinstall}
            disabled={reinstallMutation.isPending}
          >
            {reinstallMutation.isPending ? 'Réinstallation…' : 'Réinstaller'}
          </Button>
          {reinstallMutation.isSuccess && (
            <span className="text-sm text-green-600">
              Réinstallation terminée — le serveur est prêt à démarrer.
            </span>
          )}
          {reinstallMutation.isError && (
            <span className="text-sm text-destructive">
              {reinstallMutation.error.message}
            </span>
          )}
        </CardFooter>
      </Card>

      <Separator />

      {/* ─── Danger zone (deletion — already existing feature) ─── */}
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
            onClick={() => {
              if (confirm(`Supprimer « ${server?.name} » ? Le dossier sera effacé.`)) {
                remove.mutate();
              }
            }}
            disabled={remove.isPending}
          >
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
    </main>
  );
}
