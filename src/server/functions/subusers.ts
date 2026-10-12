import { createServerFn } from '@tanstack/react-start';
import { initOrm } from '~/db';
import { Server, ServerUser, User } from '~/db/entities';
import { nanoid } from '~/lib/nanoid';
import { requireUser, HttpError, loadServerWithPermission } from '../session';
import {
  flattenPermissions,
  sanitizeStatements,
  isSubset,
  type PermissionStatements,
} from '~/lib/permissions';
import {
  listServerUsersSchema,
  addServerUserSchema,
  updateServerUserSchema,
  removeServerUserSchema,
} from '~/validators/server';

/**
 * Sub-user management (Pelican "Users" tab of a server): per-server
 * permission grants stored in `server_user`.
 *
 * Pelican-style escalation rule: a sub-user may only grant a SUBSET of
 * their own permissions (owners/admins can grant the full catalog).
 */

/**
 * Validates a candidate grant against the actor's ceiling: a sub-user may
 * only grant a subset of their own permissions (owners/admins hold the
 * full catalog and can grant anything).
 */
function assertWithinCeiling(
  grant: string[],
  viewer: { isSubuser: boolean; permissions: string[] },
): void {
  if (viewer.isSubuser && !isSubset(grant, viewer.permissions)) {
    throw new HttpError(
      403,
      'Tu ne peux accorder que les permissions que tu possèdes toi-même',
    );
  }
}

// ─── List ────────────────────────────────────────────────────────────────────

export const listServerUsersFn = createServerFn({ method: 'GET' })
  .validator(listServerUsersSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await loadServerWithPermission(data.serverId, user, { 'server.users': ['read'] });

    const orm = await initOrm();
    const em = orm.em.fork();
    const grants = await em.find(ServerUser, { serverId: data.serverId });
    const users = await em.find(User, { id: { $in: grants.map((g) => g.userId) } });

    return grants.map((grant) => ({
      id: grant.id,
      userId: grant.userId,
      name: users.find((u) => u.id === grant.userId)?.name ?? '—',
      email: users.find((u) => u.id === grant.userId)?.email ?? '—',
      permissions: flattenPermissions(sanitizeStatements(grant.permissions ?? {})),
      createdAt: grant.createdAt ? grant.createdAt.toISOString() : null,
    }));
  });

// ─── Add (invite an existing account by email) ───────────────────────────────

export const addServerUserFn = createServerFn({ method: 'POST' })
  .validator(addServerUserSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server, viewer } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.users': ['create'] },
    );

    const statements = sanitizeStatements(data.permissions);
    const grant = flattenPermissions(statements);
    if (grant.length === 0) {
      throw new HttpError(422, 'Sélectionne au moins une permission');
    }
    assertWithinCeiling(grant, viewer);

    const target = await em.findOne(User, { email: data.email });
    if (!target) {
      throw new HttpError(404, 'Aucun compte avec cette adresse e-mail');
    }
    if (target.id === server.ownerId) {
      throw new HttpError(409, 'Le propriétaire a déjà tous les droits');
    }

    const existing = await em.findOne(ServerUser, {
      serverId: server.id,
      userId: target.id,
    });
    if (existing) {
      throw new HttpError(409, 'Cet utilisateur a déjà accès à ce serveur');
    }

    const now = new Date();
    em.persist(
      em.create(ServerUser, {
        id: nanoid(),
        serverId: server.id,
        userId: target.id,
        permissions: statements,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await em.flush();

    return { userId: target.id, permissions: grant };
  });

// ─── Update permissions ──────────────────────────────────────────────────────

export const updateServerUserFn = createServerFn({ method: 'POST' })
  .validator(updateServerUserSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server, viewer } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.users': ['update'] },
    );

    const row = await em.findOne(ServerUser, {
      serverId: server.id,
      userId: data.userId,
    });
    if (!row) throw new HttpError(404, 'Cet utilisateur n’a pas accès à ce serveur');

    const statements: PermissionStatements = sanitizeStatements(data.permissions);
    const grant = flattenPermissions(statements);
    if (grant.length === 0) {
      throw new HttpError(422, 'Sélectionne au moins une permission');
    }
    assertWithinCeiling(grant, viewer);

    row.permissions = statements;
    await em.flush();

    return { userId: data.userId, permissions: grant };
  });

// ─── Remove ──────────────────────────────────────────────────────────────────

export const removeServerUserFn = createServerFn({ method: 'POST' })
  .validator(removeServerUserSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(
      data.serverId,
      user,
      { 'server.users': ['delete'] },
    );

    const row = await em.findOne(ServerUser, {
      serverId: server.id,
      userId: data.userId,
    });
    if (!row) throw new HttpError(404, 'Cet utilisateur n’a pas accès à ce serveur');

    em.remove(row);
    await em.flush();
    return { removed: true };
  });
