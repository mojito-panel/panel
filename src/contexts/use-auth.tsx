import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { createContext, type ReactNode, useContext } from 'react';
import { toast } from 'sonner';

import type { SessionInfo, SessionUser } from '~/db/types';
import { signOutFn } from '~/server/functions/auth';

interface AuthContextState {
  user: SessionUser | null;
  session: SessionInfo | null;
  useSignOut: () => UseMutationResult<void, Error, void, unknown>;
}

export const AuthContext = createContext({} as AuthContextState);

interface AuthProviderProps {
  children: ReactNode;
  user: SessionUser | null;
  session: SessionInfo | null;
}

export const AuthProvider = ({ children, user, session }: AuthProviderProps) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const signOut = useServerFn(signOutFn);

  const useSignOut = () =>
    useMutation({
      mutationFn: async () => {
        await signOut();
        // Clear the cache instead of invalidating: invalidateQueries() would
        // refetch every active query as a guest (401 storm) while we are
        // still on the page. router.invalidate() re-runs the root beforeLoad,
        // which refetches ['auth'] (now empty) — the guards then redirect
        // to /login.
        queryClient.clear();
        await router.invalidate();
        toast.success('À bientôt ! 👋');
      },
    });

  return <AuthContext value={{ user, session, useSignOut }}>{children}</AuthContext>;
};

export const useAuth = () => useContext(AuthContext);
