import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /servers/$serverId/users — sous-utilisateurs (accès partagé). */
export const Route = createFileRoute('/servers/$serverId/users')({
  component: ServerUsersPage,
});

function ServerUsersPage() {
  return (
    <NotImplemented
      title="Utilisateurs"
      description="Sous-utilisateurs du serveur : accès partagé au serveur avec permissions granulaires (console, fichiers, sauvegardes, réseau…)."
      pelican="Users (subusers)"
    />
  );
}
