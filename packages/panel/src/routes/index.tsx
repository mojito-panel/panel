import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '~/components/ui/button';
import { useAuth } from '~/contexts/use-auth';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { user, useSignOut } = useAuth();
  const signOut = useSignOut();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Mojito Panel</h1>
      <p className="text-muted-foreground">
        Panel d'hébergement de serveurs de jeux — natif Windows, sans Docker.
      </p>

      {user ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm">
            Connecté en tant que <strong>{user.name}</strong> ({user.email}) — rôle{' '}
            <strong>{user.role}</strong>
          </p>
          <div className="flex gap-3">
            <Button variant="outline" asChild>
              <Link to="/servers">Mes serveurs</Link>
            </Button>
            <Button
              variant="destructive"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              {signOut.isPending ? 'Déconnexion...' : 'Se déconnecter'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <Button asChild>
            <Link to="/login">Se connecter</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/register">S'inscrire</Link>
          </Button>
        </div>
      )}
    </main>
  );
}
