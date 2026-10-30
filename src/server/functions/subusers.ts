import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { ServerUser, User } from '~/db/entities';
import {
  flattenPermissions,
  sanitizeStatements,
  isSubset,
  type PermissionStatements,
} from '~/lib/permissions';
import { serverSubusersList } from '~/lists/subusers';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import {
  addServerUserSchema,
  updateServerUserSchema,
  removeServerUserSchema,
} from '~/validators/server';

import { logActivity } from '../activity';
import { withOrmContext } from '../middleware';
import { requireUser, HttpError, loadServerWithPermission } from '../session';

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
    throw new HttpError(403, 'Tu ne peux accorder que les permissions que tu possèdes toi-même');
  }
}

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * Query of the Users tab: the paginated list query PLUS the server it is scoped
 * to — the server id is a route param, not a search param, so it travels
 * alongside the rest of the payload.
 */
const listServerUsersQuerySchema = serverSubusersList.querySchema.and(
  z.object({ serverId: z.string().min(1) }),
);

/**
 * Sub-users of ONE server — filter/search/sort/pagination run in the database
 * (`serverSubusersList`). The scoping `serverId` sits on the query builder
 * BEFORE `runListQuery`, so it applies to the rows AND the total; the joined
 * `user` table is pulled in only when a filter or the sort needs it.
 */
export const listServerUsersFn = createServerFn({ method: 'POST' })
  .validator(listServerUsersQuerySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.users': ['read'],
    });

    // `loadServerWithPermission` types its em loosely; the shared builder wants
    // the Postgres entity manager (same runtime object).
    const qb = listQueryBuilder(em, ServerUser, serverSubusersList);
    qb.andWhere({ serverId: server.id });

    const { rows, rowCount } = await runListQuery(qb, serverSubusersList.spec, data);

    // Display names/e-mails of the current page only (queries stay bounded by pageSize).
    const accounts = await em.find(User, {
      id: { $in: [...new Set(rows.map((grant) => grant.userId))] },
    });
    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    return {
      rowCount,
      rows: rows.map((grant) => ({
        id: grant.id,
        userId: grant.userId,
        name: accountsById.get(grant.userId)?.name ?? '—',
        email: accountsById.get(grant.userId)?.email ?? '—',
        permissions: flattenPermissions(sanitizeStatements(grant.permissions ?? {})),
        createdAt: grant.createdAt,
      })),
    };
  });

// ─── Add (invite an existing account by email) ───────────────────────────────

export const addServerUserFn = createServerFn({ method: 'POST' })
  .validator(addServerUserSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server, viewer } = await loadServerWithPermission(data.serverId, user, {
      'server.users': ['create'],
    });

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
        serverId: server.id,
        userId: target.id,
        permissions: statements,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await em.flush();

    await logActivity({
      event: 'subuser:add',
      description: `${target.email} invité comme sous-utilisateur de « ${server.name} »`,
      actor: { id: user.id, name: user.name, email: user.email },
      server: { id: server.id, name: server.name },
      properties: { targetUserId: target.id, permissions: grant },
    });

    return { userId: target.id, permissions: grant };
  });

// ─── Update permissions ──────────────────────────────────────────────────────

export const updateServerUserFn = createServerFn({ method: 'POST' })
  .validator(updateServerUserSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server, viewer } = await loadServerWithPermission(data.serverId, user, {
      'server.users': ['update'],
    });

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

    await logActivity({
      event: 'subuser:update',
      description: `Permissions de l'utilisateur ${data.userId} mises à jour sur « ${server.name} »`,
      actor: { id: user.id, name: user.name, email: user.email },
      server: { id: server.id, name: server.name },
      properties: { targetUserId: data.userId, permissions: grant },
    });

    return { userId: data.userId, permissions: grant };
  });

// ─── Remove ──────────────────────────────────────────────────────────────────

export const removeServerUserFn = createServerFn({ method: 'POST' })
  .validator(removeServerUserSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { em, server } = await loadServerWithPermission(data.serverId, user, {
      'server.users': ['delete'],
    });

    const row = await em.findOne(ServerUser, {
      serverId: server.id,
      userId: data.userId,
    });
    if (!row) throw new HttpError(404, 'Cet utilisateur n’a pas accès à ce serveur');

    em.remove(row);
    await em.flush();

    await logActivity({
      event: 'subuser:remove',
      description: `Accès de l'utilisateur ${data.userId} retiré sur « ${server.name} »`,
      actor: { id: user.id, name: user.name, email: user.email },
      server: { id: server.id, name: server.name },
    });

    return { removed: true };
  });
