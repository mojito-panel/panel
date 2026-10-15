import { createServerFn } from '@tanstack/react-start';
import { sql } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { initOrm } from '~/db';
import { Account, Server, Session, ServerUser, User, PanelRole } from '~/db/entities';
import { adminUsersList } from '~/lists/users';
import { listQueryBuilder, runListQuery } from '~/server/list/query';
import {
  requireUser,
  requirePanelPermission,
  HttpError,
} from '../session';
import { auth } from '~/lib/auth';
import { BUILT_IN_ROLE_LABELS, PANEL_ROLES, type PanelRoleName } from '~/lib/permissions';
import { usernameSchema } from '~/validators/auth';

/**
 * Admin panel user management. Roles and per-server grants live in the
 * panel DB (source of truth), but ACCOUNT CREATION goes through
 * better-auth's own endpoints (admin create-user / sign-up) — never
 * hand-rolled rows: better-auth owns the user/account relationship
 * (scrypt hash, credential accountId === user.id, see
 * docs/concepts/users-accounts).
 *
 * Authorization stays on the panel side (`requirePanelPermission`): it
 * honors CUSTOM roles from the `role` table, which the admin plugin's
 * endpoint checks (static built-in roles only) don't know — the creation
 * endpoint is therefore called WITHOUT forwarding the actor's session.
 *
 * The admin plugin still provides the model (role/banned/ban_* columns)
 * and enforces bans at session creation; its tables are managed by
 * MikroORM — the better-auth CLI NEVER generates a migration in this
 * project.
 */

// ─── Guards (business rules) ────────────────────────────────────────────────

/** Self-lockout protection: never change your own role / ban / delete yourself. */
function assertNotSelf(actorId: string, targetId: string): void {
  if (actorId === targetId) {
    throw new HttpError(422, 'Tu ne peux pas faire cela sur ton propre compte');
  }
}

/** Refuses to demote/ban/delete the LAST admin (lockout of the whole panel). */
async function assertNotLastAdmin(targetRole: string): Promise<void> {
  if (targetRole !== 'admin') return;
  const orm = await initOrm();
  const em = orm.em.fork();
  const admins = await em.count(User, { role: 'admin' });
  if (admins <= 1) {
    throw new HttpError(409, 'Il doit rester au moins un administrateur');
  }
}

/** The value of `user.role` must be a built-in name or an existing custom role. */
async function assertRoleExists(roleId: string): Promise<void> {
  if (PANEL_ROLES[roleId as PanelRoleName]) return;
  const orm = await initOrm();
  const em = orm.em.fork();
  const row = await em.findOne(PanelRole, { id: roleId });
  if (!row) throw new HttpError(422, `Le rôle « ${roleId} » n’existe pas`);
}

/** Display name of a role value (built-in label or custom role name). */
function roleLabel(roleId: string, customRoles: { id: string; name: string }[]): string {
  return (
    BUILT_IN_ROLE_LABELS[roleId as PanelRoleName] ??
    customRoles.find((r) => r.id === roleId)?.name ??
    roleId
  );
}

// ─── List (search + filter + sort + pagination) ───────────────────────────────

/**
 * User list of the admin area — filter/sort/pagination run in the database
 * (`adminUsersList`). The per-page server count is one grouped count over the
 * page's owner ids (never every server loaded to count in JS).
 */
export const listUsersFn = createServerFn({ method: 'POST' })
  .validator(adminUsersList.querySchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({ user: ['list'] });

    const orm = await initOrm();
    const em = orm.em.fork();

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
export const listUserOptionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePanelPermission({ user: ['list'] });

  const orm = await initOrm();
  const em = orm.em.fork();
  const users = await em.find(User, {}, { orderBy: { name: 'asc' } });

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
  .handler(async ({ data }) => {
    await requirePanelPermission({
      user: ['create', ...(data.role !== 'user' ? (['set-role'] as const) : [])],
    });
    await assertRoleExists(data.role);

    const orm = await initOrm();
    const em = orm.em.fork();

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
    const target = await em.findOne(User, { id: user.id });
    if (!target) throw new HttpError(500, 'La création du compte a échoué');
    target.role = data.role;
    await em.flush();

    return { id: user.id, email: user.email, role: data.role };
  });

// ─── Role change (promotion/demotion) ─────────────────────────────────────────

export const setUserRoleFn = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1), role: z.string().min(1) }))
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ user: ['set-role'] });
    assertNotSelf(actor.id, data.userId);
    await assertRoleExists(data.role);

    const orm = await initOrm();
    const em = orm.em.fork();
    const target = await em.findOne(User, { id: data.userId });
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');
    await assertNotLastAdmin(target.role ?? 'user');

    target.role = data.role;
    await em.flush();

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
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ user: ['ban'] });
    assertNotSelf(actor.id, data.userId);

    const orm = await initOrm();
    const em = orm.em.fork();
    const target = await em.findOne(User, { id: data.userId });
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');
    await assertNotLastAdmin(target.role ?? 'user');

    // The admin plugin checks these columns at session creation
    target.banned = true;
    target.banReason = data.banReason ?? 'Compte suspendu par un administrateur';
    target.banExpires = null; // permanent until lifted
    // Revoke every active session immediately
    const sessions = await em.find(Session, { userId: target.id });
    em.remove(sessions);
    await em.flush();

    return { userId: target.id, banned: true };
  });

export const unbanUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requirePanelPermission({ user: ['ban'] });

    const orm = await initOrm();
    const em = orm.em.fork();
    const target = await em.findOne(User, { id: data.userId });
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');

    target.banned = false;
    target.banReason = null;
    target.banExpires = null;
    await em.flush();

    return { userId: target.id, banned: false };
  });

// ─── Deletion (refused while the user still owns servers) ─────────────────────

export const deleteUserFn = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const actor = await requireUser();
    assertNotSelf(actor.id, data.userId);
    await requirePanelPermission({ user: ['delete'] });

    const orm = await initOrm();
    const em = orm.em.fork();
    const target = await em.findOne(User, { id: data.userId });
    if (!target) throw new HttpError(404, 'Utilisateur introuvable');
    await assertNotLastAdmin(target.role ?? 'user');

    const servers = await em.count(Server, { ownerId: data.userId });
    if (servers > 0) {
      throw new HttpError(409, `${servers} serveur(s) appartiennent encore à cet utilisateur`);
    }

    // Manual cleanup — the entities carry no FK relations (loose ids by design)
    const sessions = await em.find(Session, { userId: target.id });
    const accounts = await em.find(Account, { userId: target.id });
    const grants = await em.find(ServerUser, { userId: target.id });
    em.remove(sessions);
    em.remove(accounts);
    em.remove(grants);
    em.remove(target);
    await em.flush();

    return { deleted: true };
  });
