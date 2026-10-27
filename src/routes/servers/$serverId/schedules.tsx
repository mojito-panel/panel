import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /servers/$serverId/schedules — scheduled tasks (cron) placeholder page. */
export const Route = createFileRoute('/servers/$serverId/schedules')({
  component: ServerSchedulesPage,
});

function ServerSchedulesPage() {
  return (
    <NotImplemented
      title="Planifications"
      description="Tâches planifiées du serveur (cron) : backup automatique, redémarrage quotidien, exécution de commandes à intervalle régulier, avec historique des déclenchements."
      pelican="Schedules"
    />
  );
}
