import { createAuthClient } from 'better-auth/react';

/**
 * Browser-side better-auth client.
 * Provides signIn, signUp, signOut, useSession, etc.
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;

export type AuthClient = typeof authClient;
