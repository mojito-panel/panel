import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { auth } from '~/lib/auth';
import type { AuthSession } from '~/db/types';

/**
 * Récupère la session courante côté serveur (SSR).
 * Appelée dans le beforeLoad de __root.tsx via queryClient.fetchQuery.
 */
export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthSession | null> => {
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    });

    if (!session) return null;

    return {
      user: session.user as AuthSession['user'],
      session: session.session as AuthSession['session'],
    };
  },
);

/**
 * Déconnexion côté serveur — supprime le cookie de session.
 */
export const signOutFn = createServerFn({ method: 'POST' }).handler(async () => {
  await auth.api.signOut({
    headers: getRequestHeaders(),
  });
});
