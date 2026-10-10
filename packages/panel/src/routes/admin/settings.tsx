import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '~/components/not-implemented';

/** /admin/settings — réglages globaux du panel. */
export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  return (
    <NotImplemented
      title="Paramètres"
      description="Réglages globaux du panel : configuration du mail (notifications), stockage des sauvegardes, réglages avancés."
      pelican="Settings (zone admin)"
    />
  );
}
