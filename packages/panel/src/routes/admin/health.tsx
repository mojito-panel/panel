import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /admin/health — santé de l'installation. */
export const Route = createFileRoute('/admin/health')({
  component: AdminHealthPage,
});

function AdminHealthPage() {
  return (
    <NotImplemented
      title="Santé"
      description="État du système : versions des agents connectés, latence des nodes, erreurs d'installation récentes, espace disque restant."
      pelican="Health"
    />
  );
}
