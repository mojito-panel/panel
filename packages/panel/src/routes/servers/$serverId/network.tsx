import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /servers/$serverId/network — allocations IP:port. */
export const Route = createFileRoute('/servers/$serverId/network')({
  component: ServerNetworkPage,
});

function ServerNetworkPage() {
  return (
    <NotImplemented
      title="Réseau"
      description="Allocations du serveur : port principal, ports additionnels (IP:port), affectation et retrait."
      pelican="Network / Allocations"
    />
  );
}
