import { createContext, type ReactNode, useContext } from 'react';
import { useMutation, type UseMutationResult, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { signOutFn } from '~/server/functions/auth';
import type { ISession, IUser } from '~/db/types';

interface AuthContextState {
  user: IUser | null;
  session: ISession | null;
  useSignOut: () => UseMutationResult<void, Error, void, unknown>;
}

export const AuthContext = createContext({} as AuthContextState);

interface AuthProviderProps {
  children: ReactNode;
  user: IUser | null;
  session: ISession | null;
}

export const AuthProvider = ({ children, user, session }: AuthProviderProps) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const signOut = useServerFn(signOutFn);

  const useSignOut = () =>
    useMutation({
      mutationFn: async () => {
        await signOut();
        await queryClient.invalidateQueries();
        await router.invalidate();
      },
    });

  return (
    <AuthContext value={{ user, session, useSignOut }}>{children}</AuthContext>
  );
};

export const useAuth = () => useContext(AuthContext);
