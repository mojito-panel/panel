import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /servers/$serverId/activity — journal d'activité. */
export const Route = createFileRoute('/servers/$serverId/activity')({
  component: ServerActivityPage,
});

function ServerActivityPage() {
  return (
    <NotImplemented
      title="Activité"
      description="Journal d'activité du serveur : démarrages/arrêts, installations, actions des sous-utilisateurs, commandes envoyées."
      pelican="Activity"
    />
  );
}
