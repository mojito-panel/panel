import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Racine publique : redirige vers les serveurs si connecté, sinon vers /login.
 * Toutes les pages de l'app vivent sous le layout _app (sidebar).
 */
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: unknown }).user;
    throw redirect({ to: user ? '/servers' : '/login' });
  },
});
