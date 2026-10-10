import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '~/components/ui/button';
import { useAuth } from '~/contexts/use-auth';

export const Route = createFileRoute('/servers/')({
  component: ServersPage,
});

function ServersPage() {
  const { user } = useAuth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Mes serveurs</h1>
      <p className="text-muted-foreground">
        Aucun serveur pour l'instant. {user?.role === 'admin' && '(admin)'}
      </p>
      <Button variant="outline" asChild>
        <Link to="/">Retour à l'accueil</Link>
      </Button>
    </main>
  );
}
