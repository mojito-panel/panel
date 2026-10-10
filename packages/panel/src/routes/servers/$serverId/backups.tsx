import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /servers/$serverId/backups — sauvegardes. */
export const Route = createFileRoute('/servers/$serverId/backups')({
  component: ServerBackupsPage,
});

function ServerBackupsPage() {
  return (
    <NotImplemented
      title="Sauvegardes"
      description="Sauvegardes du serveur : création, restauration, téléchargement, suppression — avec taille et date de chaque archive."
      pelican="Backups"
    />
  );
}
