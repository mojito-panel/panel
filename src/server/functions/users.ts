import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { hashPassword } from 'better-auth/crypto';
import { initOrm } from '~/db';
import { Account, Server, Session, ServerUser, User, PanelRole } from '~/db/entities';
import {
  requireUser,
  requirePanelPermission,
  HttpError,
} from '../session';
import { nanoid } from '~/lib/nanoid';
import { BUILT_IN_ROLE_LABELS, PANEL_ROLES, type PanelRoleName } from '~/lib/permissions';
import { usernameSchema } from '~/validators/auth';

/**
 * Admin panel user management — DIRECT MikroORM access (panel DB is the
 * source of truth, like everywhere else), NOT the better-auth endpoints:
 * permission checks must honor CUSTOM roles from the `role` table, and the
 * admin plugin's endpoint checks only know the static built-in roles.
 *
 * The admin plugin still provides the model (role/banned/ban_* columns) and
 * enforces bans at session creation; its tables are managed by MikroORM —
 * the better-auth CLI NEVER generates a migration in this project.
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

// ─── List (search + pagination) ───────────────────────────────────────────────

export const listUsersFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requirePanelPermission({ user: ['list'] });

    const orm = await initOrm();
    const em = orm.em.fork();

    const where = data.search ? { email: { $ilike: `%${data.search}%` } } : {};
    const [users, total, customRoles, servers] = await Promise.all([
      em.find(User, where, {
        orderBy: { createdAt: 'desc' },
        limit: data.limit ?? 50,
        offset: data.offset ?? 0,
      }),
      em.count(User, where),
      em.find(PanelRole, {}),
      em.find(Server, {}),
    ]);

    return {
      total,
      users: users.map((user) => ({
        id: user.id,
        name: user.name ?? null,
        email: user.email,
        role: user.role,
        roleName: roleLabel(user.role ?? 'user', customRoles),
        banned: user.banned ?? false,
        banReason: user.banReason ?? null,
        banExpires: user.banExpires ? user.banExpires.toISOString() : null,
        createdAt: user.createdAt ? user.createdAt.toISOString() : null,
        serverCount: servers.filter((s) => s.ownerId === user.id).length,
      })),
    };
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

    // Same password format as better-auth (scrypt) — the account can sign in
    const password = await hashPassword(data.password);
    const now = new Date();
    const user = em.create(User, {
      id: nanoid(),
      name: data.name,
      username,
      email,
      emailVerified: true,
      role: data.role,
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    });
    em.persist(user);
    em.persist(
      em.create(Account, {
        id: nanoid(),
        accountId: email,
        providerId: 'credential',
        userId: user.id,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await em.flush();

    return { id: user.id, email: user.email, role: user.role };
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
