import { getRequestHeaders } from '@tanstack/react-start/server';
import { auth } from '~/lib/auth';
import type { IUser } from '~/db/types';

/** Erreur HTTP depuis une server function (message propagé au client). */
export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Retourne l'utilisateur de la session courante, ou null. */
export async function getSessionUser(): Promise<IUser | null> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  return (session?.user as IUser | undefined) ?? null;
}

/** Exige une session — 401 sinon. */
export async function requireUser(): Promise<IUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new HttpError(401, 'Non authentifié');
  }
  return user;
}

/** Exige le rôle admin — 403 sinon. */
export async function requireAdmin(): Promise<IUser> {
  const user = await requireUser();
  if (user.role !== 'admin') {
    throw new HttpError(403, 'Accès réservé aux administrateurs');
  }
  return user;
}
