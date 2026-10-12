import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { auth } from '~/lib/auth';
import type { AuthSession } from '~/db/types';
import { resolvePanelPermissions } from '../session';

/**
 * Fetches the current session server-side (SSR).
 * Called in __root.tsx's beforeLoad via queryClient.fetchQuery.
 */
export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthSession | null> => {
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    });

    if (!session) return null;

    // Explicit mapping to the serializable DTO — no raw entity type
    // (IUser/ISession carry non-serializable MikroORM IndexHints).
    // The effective permissions resolve the role (built-in or custom).
    const role = session.user.role ?? 'user';
    return {
      user: {
        id: session.user.id,
        name: session.user.name ?? null,
        username: session.user.username ?? null,
        email: session.user.email,
        role,
        permissions: await resolvePanelPermissions(role),
      },
      session: {
        id: session.session.id,
        expiresAt: session.session.expiresAt,
      },
    };
  },
);

/**
 * Server-side sign-out — deletes the session cookie.
 */
export const signOutFn = createServerFn({ method: 'POST' }).handler(async () => {
  await auth.api.signOut({
    headers: getRequestHeaders(),
  });
});
