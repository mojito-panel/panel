import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /servers/$serverId/startup — variables de démarrage. */
export const Route = createFileRoute('/servers/$serverId/startup')({
  component: ServerStartupPage,
});

function ServerStartupPage() {
  return (
    <NotImplemented
      title="Démarrage"
      description="Variables du serveur : édition des variables du plugin (JAVA_VERSION, version du jeu, mot de passe RCON…) avec leur validation, et commande de démarrage résolue en lecture seule."
      pelican="Startup (variables)"
    />
  );
}
