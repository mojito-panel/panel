import '@tanstack/react-start/server-only';
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql';
import { getRequestHeaders } from '@tanstack/react-start/server';
import type { Role } from 'better-auth/plugins/access';

import { Server, ServerUser, PanelRole } from '~/db/entities';
import type { IUser, IServer } from '~/db/types';
import { auth } from '~/lib/auth';
import {
  can,
  ownerRole,
  subuserRole,
  panelRole,
  PANEL_ROLES,
  type PanelRoleName,
  flattenPermissions,
  parsePermissions,
  sanitizeStatements,
  ALL_SERVER_PERMISSIONS,
  type PermissionRequest,
} from '~/lib/permissions';

import { orm } from './orm';

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

/**
 * Resolves the Role of a `user.role` value: built-in names (admin /
 * moderator / user) come from the code catalog, anything else is looked up
 * in the `role` table (custom Pelican-style roles, managed from
 * /admin/roles). Unknown values degrade to the plain user role.
 */
export async function resolvePanelRole(name: string): Promise<Role> {
  if (PANEL_ROLES[name as PanelRoleName]) return PANEL_ROLES[name as PanelRoleName];
  if (name === 'user' || !name) return panelRole('user');
  const em = orm.em;
  const row = await em.findOne(PanelRole, { id: name });
  if (!row) return panelRole('user');
  return subuserRole(sanitizeStatements(row.permissions ?? {}));
}

/** Effective flat panel permissions of a `user.role` value. */
export async function resolvePanelPermissions(name: string): Promise<string[]> {
  return flattenPermissions((await resolvePanelRole(name)).statements);
}

/**
 * Requires a PANEL-level permission (admin area, user management) — the
 * request is checked against the user's role, resolved from the built-in
 * catalog or the `role` table (better-auth access control, see
 * `~/lib/permissions`). 403 otherwise.
 */
export async function requirePanelPermission(
  request: PermissionRequest,
  connector: 'AND' | 'OR' = 'AND',
): Promise<IUser> {
  const user = await requireUser();
  const role = await resolvePanelRole(user.role);
  if (!can(role, request, connector)) {
    throw new HttpError(403, 'Accès refusé : permission manquante');
  }
  return user;
}

// ─── Per-server access (owner / admin / sub-user grant) ──────────────────────

/** What the current user can do on one server (serializable, shared with the UI). */
export interface ServerViewer {
  isOwner: boolean;
  isAdmin: boolean;
  isSubuser: boolean;
  /** Flat permission list ("server.files.read") — full set for owner/admin. */
  permissions: string[];
}
export interface ServerAccess {
  em: PostgreSqlEntityManager;
  server: IServer;
  viewer: ServerViewer;
}

/**
 * Loads a server + resolves the viewer's per-server permissions:
 * owner or admin role → full permission set; anyone else → their
 * `server_user` grant (403 when there is none). 404 when the server is
 * unknown.
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
export async function loadServerForViewer(serverId: string, user: IUser): Promise<ServerAccess> {
  const em = orm.em;
  const server = await em.findOne(Server, { id: serverId });
  if (!server) {
    throw new HttpError(404, 'Serveur introuvable');
  }

  const isAdmin = user.role === 'admin';
  const isOwner = server.ownerId === user.id;

  // Pelican semantics: a suspended server is completely hidden from its
  // owner and sub-users — only an admin (from the admin area) can reach it.
  if (server.suspended && !isAdmin) {
    throw new HttpError(403, 'Ce serveur est suspendu par un administrateur');
  }

  if (isAdmin || isOwner) {
    return {
      em,
      server,
      viewer: { isOwner, isAdmin, isSubuser: false, permissions: ALL_SERVER_PERMISSIONS },
    };
  }

  const grant = await em.findOne(ServerUser, { serverId: server.id, userId: user.id });
  if (!grant) {
    throw new HttpError(403, 'Tu n’as pas accès à ce serveur');
  }

  const statements = sanitizeStatements(grant.permissions ?? {});
  const permissions = flattenPermissions(statements);
  if (permissions.length === 0) {
    throw new HttpError(403, 'Tu n’as pas accès à ce serveur');
  }

  return { em, server, viewer: { isOwner, isAdmin, isSubuser: true, permissions } };
}

/**
 * Loads a server + requires a per-server permission — the Pelican sub-user
 * gate: owners/admins always pass, sub-users only with the matching grant.
 */
export async function loadServerWithPermission(
  serverId: string,
  user: IUser,
  request: PermissionRequest,
  connector: 'AND' | 'OR' = 'AND',
): Promise<ServerAccess> {
  const access = await loadServerForViewer(serverId, user);
  const role = access.viewer.isSubuser
    ? subuserRole(parsePermissions(access.viewer.permissions))
    : ownerRole;
  if (!can(role, request, connector)) {
    throw new HttpError(403, 'Permission manquante sur ce serveur');
  }
  return access;
}

/**
 * Requires server ownership (or the admin role) — used for destructive,
 * non-delegable actions (deleting the server).
 */
export async function requireServerOwner(serverId: string, user: IUser): Promise<ServerAccess> {
  const access = await loadServerForViewer(serverId, user);
  if (!access.viewer.isOwner && !access.viewer.isAdmin) {
    throw new HttpError(403, 'Seul le propriétaire peut faire cela');
  }
  return access;
}
