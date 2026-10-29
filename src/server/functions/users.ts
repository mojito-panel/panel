import { createServerFn } from '@tanstack/react-start';
import { sql } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { PanelRole, User } from '~/db/entities';
import { adminUsersList } from '~/lists/users';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import { requireUser, requirePanelPermission, HttpError } from '../session';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import {
  assertNotSelf,
  assertNotLastAdmin,
  assertRoleExists,
  requireUserById,
  roleLabel,
  banUser,
  unbanUser,
  deleteUser,
} from '../users';
import { auth } from '~/lib/auth';
import { logActivity } from '../activity';
import { usernameSchema } from '~/validators/auth';

/**
 * Admin panel user management. Roles and per-server grants live in the
 * Roles/Sub-users pages — here: list, create (better-auth), role change,
 * ban/unban, delete. All DB work goes through `server/users.ts` inside the
 * request context opened by `withOrmContext`.
 */

// ─── List (search + filter + sort + pagination) ───────────────────────────────

/**
 * User list of the admin area — filter/sort/pagination run in the database
 * (`adminUsersList`). The per-page server count is one grouped count over the
 * page's owner ids (never every server loaded to count in JS).
 */
export const listUsersFn = createServerFn({ method: 'POST' })
  .validator(adminUsersList.querySchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    await requirePanelPermission({ user: ['list'] });
    const em = orm.em;

    const { rows, rowCount } = await runListQuery(
      listQueryBuilder(em, User, adminUsersList),
      adminUsersList.spec,
      data,
    );

    const ids = rows.map((user) => user.id);
    const [customRoles, serverCounts] = await Promise.all([
      em.find(PanelRole, {}),
      ids.length > 0
        ? em.getConnection().execute<{ owner_id: string; count: number }[]>(
            sql`select owner_id, count(*)::int as count from "server" where owner_id in (${ids}) group by owner_id`,
          )
        : Promise.resolve<{ owner_id: string; count: number }[]>([]),
    ]);

    const countByOwner = new Map(serverCounts.map((row) => [row.owner_id, row.count]));

    return {
      rowCount,
      rows: rows.map((user) => ({
        id: user.id,
        name: user.name ?? null,
        email: user.email,
        username: user.username ?? null,
        role: user.role ?? 'user',
        roleName: roleLabel(user.role ?? 'user', customRoles),
        banned: user.banned ?? false,
        serverCount: countByOwner.get(user.id) ?? 0,
        createdAt: user.createdAt,
      })),
    };
  });

// ─── Options (owner pickers) ──────────────────────────────────────────────────

/**
 * Every user as a light `{ id, name, email }` option, sorted by name — feeds the
 * owner picker of the admin server page. Kept separate from the paginated list
 * function: a picker needs the whole set, not a page of it.
 */
export const listUserOptionsFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    await requirePanelPermission({ user: ['list'] });
    const users = await orm.em.find(User, {}, { orderBy: { name: 'asc' } });

    return users.map((user) => ({
      id: user.id,
      name: user.name ?? null,
      email: user.email,
    }));
  });

// ─── Create ──────────────────────────────────────────────────────────────────

export const createUserFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(2, 'Le nom doit faire au moins 2 caractères').max(128),
      username: usernameSchema,
      email: z.string().email('Email invalide'),
      password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
      /** Built-in role name or custom role id. */
      role: z.string().min(1),
    }),
  )
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({
      user: ['create', ...(data.role !== 'user' ? (['set-role'] as const) : [])],
    });
    await assertRoleExists(data.role);

    const em = orm.em;
    const email = data.email.toLowerCase();
    const existing = await em.findOne(User, { email });
    if (existing) throw new HttpError(409, 'Un compte utilise déjà cet e-mail');
    const username = data.username.toLowerCase();
    const existingUsername = await em.findOne(User, { username });
    if (existingUsername) throw new HttpError(409, 'Ce nom d’utilisateur est déjà utilisé');

    // better-auth's admin create-user endpoint builds the account rows
    // itself (scrypt hash, credential accountId === user.id). Called
    // WITHOUT forwarding the actor's session: authorization is the panel
    // permission check above (custom roles), which the endpoint's own
    // static built-in-role check doesn't know.
    const { user } = await auth.api.createUser({
      body: {
        email,
        password: data.password,
        name: data.name,
        data: { emailVerified: true, username },
      },
    });

    // Panel-specific field better-auth's user model doesn't carry: `role`
    // (the endpoint only accepts the static built-in role names, not
    // custom role ids from the `role` table).
    const target = await requireUserById(user.id);
    target.role = data.role;
    await em.flush();

    await logActivity({ event: 'user:create', description: `Compte « ${data.email} » créé (rôle « ${data.role} »)`, actor: { id: actor.id, name: actor.name, email: actor.email }, properties: { targetUserId: target.id, role: data.role } });

    return { id: user.id, email: user.email, role: data.role };
  });

// ─── Role change (promotion/demotion) ─────────────────────────────────────────

export const setUserRoleFn = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1), role: z.string().min(1) }))
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ user: ['set-role'] });
    assertNotSelf(actor.id, data.userId);
    await assertRoleExists(data.role);

    const target = await requireUserById(data.userId);
    await assertNotLastAdmin(target.role ?? 'user');

    target.role = data.role;
    await orm.em.flush();
    await logActivity({ event: 'user:set_role', description: `Rôle de « ${target.email} » changé en « ${data.role} »`, actor: { id: actor.id, name: actor.name, email: actor.email }, properties: { targetUserId: target.id, role: data.role } });

    return { userId: data.userId, role: data.role };
  });

// ─── Suspension (ban / unban — sessions are revoked immediately) ────────────

export const banUserFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      userId: z.string().min(1),
      banReason: z.string().max(255).optional(),
    }),
  )
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ user: ['ban'] });
    assertNotSelf(actor.id, data.userId);

    const target = await requireUserById(data.userId);
    await assertNotLastAdmin(target.role ?? 'user');
    await banUser(target, data.banReason);
    await logActivity({ event: 'user:ban', description: `Compte « ${target.email} » suspendu`, actor: { id: actor.id, name: actor.name, email: actor.email }, properties: { targetUserId: target.id, banReason: data.banReason ?? null } });

    return { userId: target.id, banned: true };
  });

export const unbanUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1) }))
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ user: ['ban'] });
    const target = await requireUserById(data.userId);
    await unbanUser(target);
    await logActivity({ event: 'user:unban', description: `Compte « ${target.email} » réactivé`, actor: { id: actor.id, name: actor.name, email: actor.email }, properties: { targetUserId: target.id } });
    return { userId: target.id, banned: false };
  });

// ─── Deletion (refused while the user still owns servers) ─────────────────────

export const deleteUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1) }))
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const actor = await requireUser();
    assertNotSelf(actor.id, data.userId);
    await requirePanelPermission({ user: ['delete'] });

    const target = await requireUserById(data.userId);
    await assertNotLastAdmin(target.role ?? 'user');
    await deleteUser(target);
    await logActivity({ event: 'user:delete', description: `Compte « ${target.email} » supprimé`, actor: { id: actor.id, name: actor.name, email: actor.email }, properties: { targetUserId: target.id } });

    return { deleted: true };
  });
