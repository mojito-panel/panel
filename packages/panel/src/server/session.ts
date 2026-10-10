import { getRequestHeaders } from '@tanstack/react-start/server';
import { auth } from '~/lib/auth';
import type { IUser } from '~/db/types';

/** HTTP error thrown from a server function (message propagated to the client). */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Returns the current session's user, or null. */
export async function getSessionUser(): Promise<IUser | null> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  return (session?.user as IUser | undefined) ?? null;
}

/** Requires a session — 401 otherwise. */
export async function requireUser(): Promise<IUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new HttpError(401, 'Non authentifié');
  }
  return user;
}

/** Requires the admin role — 403 otherwise. */
export async function requireAdmin(): Promise<IUser> {
  const user = await requireUser();
  if (user.role !== 'admin') {
    throw new HttpError(403, 'Accès réservé aux administrateurs');
  }
  return user;
}
