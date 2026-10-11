import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /admin/servers — tous les serveurs, tous propriétaires (gestion admin). */
export const Route = createFileRoute('/admin/servers')({
  component: AdminServersPage,
});

function AdminServersPage() {
  return (
    <NotImplemented
      title="Serveurs"
      description="Liste de tous les serveurs de l'installation (tous propriétaires confondus) avec recherche, filtre par node, actions d'administration (suspendre, supprimer)."
      pelican="Servers (zone admin)"
    />
  );
}
