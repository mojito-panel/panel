import { createFileRoute } from '@tanstack/react-router';

import { NotImplemented } from '~/components/not-implemented';

/** /admin/api — clés API d'application (intégrations tierces). */
export const Route = createFileRoute('/admin/api')({
  component: AdminApiPage,
});

function AdminApiPage() {
  return (
    <NotImplemented
      title="API"
      description="Clés API d'application pour les intégrations tierces (création/ révocation, permissions par ressource)."
      pelican="API / Application API keys"
    />
  );
}
