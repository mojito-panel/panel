import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /admin — vue d'ensemble de l'administration (Pelican admin overview). */
export const Route = createFileRoute('/admin/')({
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  return (
    <NotImplemented
      title="Vue d'ensemble"
      description="Tableau de bord de l'infrastructure : compteurs de serveurs, nodes et utilisateurs, état des agents, dernières installations."
      pelican="Overview (zone admin)"
    />
  );
}
