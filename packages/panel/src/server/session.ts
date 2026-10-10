import '@tanstack/react-start/server-only';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { auth } from '~/lib/auth';
import { initOrm } from '~/db';
import { Server } from '~/db/entities';
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

/**
 * Loads a server + checks ownership (admin = access to everything).
 *
 * This module is server-only (marker import above) — import protection fails
 * the build if it ever reaches client-reachable code. The helper lives here
 * and NOT in a `createServerFn` file (functions/*.ts): the Start compiler
 * prunes server code only inside the boundaries it recognizes (handler
 * bodies), so a plain value export next to server functions survives the
 * client compilation and drags its server-only imports (~/db → pg → Buffer)
 * into the browser bundle. See the Import Protection guide, "Common Pitfall:
 * Why Some Imports Stay Alive".
 */
export async function loadOwnedServer(serverId: string, userId: string, isAdmin: boolean) {
  const orm = await initOrm();
  const em = orm.em.fork();
  const server = await em.findOne(Server, { id: serverId });
  if (!server) {
    throw new HttpError(404, 'Serveur introuvable');
  }
  if (!isAdmin && server.ownerId !== userId) {
    throw new HttpError(403, 'Ce serveur ne t’appartient pas');
  }
  return { em, server };
}
