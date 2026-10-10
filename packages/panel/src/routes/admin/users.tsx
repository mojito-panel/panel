import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /admin/users — gestion des comptes du panel. */
export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  return (
    <NotImplemented
      title="Utilisateurs"
      description="Comptes du panel : création, modification, promotion admin, suspension. Inclut la liste des serveurs appartenant à chaque utilisateur."
      pelican="Users (zone admin)"
    />
  );
}
