import '@tanstack/react-start/server-only';
import { Session, Account, Server, ServerUser, User, PanelRole } from '~/db/entities';
import { orm } from './orm';
import { HttpError } from './session';
import { resolvePanelPermissions } from './session';
import { BUILT_IN_ROLE_LABELS, PANEL_ROLES, isSubset, type PanelRoleName } from '~/lib/permissions';
import type { IUser } from '~/db/types';

/**
 * Panel user + role business service (server-only): plain functions doing
 * all the DB work of the admin Users / Roles pages, running inside the
 * caller's MikroORM request context (the `withOrmContext` middleware).
 */

/** Self-lockout protection: never change your own role / ban / delete yourself. */
export function assertNotSelf(actorId: string, targetId: string): void {
  if (actorId === targetId) {
    throw new HttpError(422, 'Tu ne peux pas faire cela sur ton propre compte');
  }
}

/** Refuses to demote/ban/delete the LAST admin (lockout of the whole panel). */
export async function assertNotLastAdmin(targetRole: string): Promise<void> {
  if (targetRole !== 'admin') return;
  const admins = await orm.em.count(User, { role: 'admin' });
  if (admins <= 1) {
    throw new HttpError(409, 'Il doit rester au moins un administrateur');
  }
}

/** The value of `user.role` must be a built-in name or an existing custom role. */
export async function assertRoleExists(roleId: string): Promise<void> {
  if (PANEL_ROLES[roleId as PanelRoleName]) return;
  const row = await orm.em.findOne(PanelRole, { id: roleId });
  if (!row) throw new HttpError(422, `Le rôle « ${roleId} » n’existe pas`);
}

/** Loads a user (404 when unknown). */
export async function requireUserById(userId: string): Promise<IUser> {
  const target = await orm.em.findOne(User, { id: userId });
  if (!target) throw new HttpError(404, 'Utilisateur introuvable');
  return target;
}

/** Display name of a role value (built-in label or custom role name). */
export function roleLabel(roleId: string, customRoles: { id: string; name: string }[]): string {
  return (
    BUILT_IN_ROLE_LABELS[roleId as PanelRoleName] ??
    customRoles.find((r) => r.id === roleId)?.name ??
    roleId
  );
}

/**
 * Bans a user: sets the admin-plugin columns (checked at session creation)
 * and revokes every active session immediately. Permanent until lifted.
 */
export async function banUser(
  target: IUser,
  banReason?: string,
): Promise<void> {
  const em = orm.em;
  // The admin plugin checks these columns at session creation
  target.banned = true;
  target.banReason = banReason ?? 'Compte suspendu par un administrateur';
  target.banExpires = null; // permanent until lifted
  // Revoke every active session immediately
  const sessions = await em.find(Session, { userId: target.id });
  em.remove(sessions);
  await em.flush();
}

/** Lifts a ban (clears the three admin-plugin columns). */
export async function unbanUser(target: IUser): Promise<void> {
  target.banned = false;
  target.banReason = null;
  target.banExpires = null;
  await orm.em.flush();
}

/**
 * Deletes a user — refused while they still own servers. Manual cleanup of
 * the better-auth rows: the entities carry no FK relations (loose ids by
 * design), so sessions/accounts/grants are removed explicitly.
 */
export async function deleteUser(target: IUser): Promise<void> {
  const em = orm.em;
  const servers = await em.count(Server, { ownerId: target.id });
  if (servers > 0) {
    throw new HttpError(409, `${servers} serveur(s) appartiennent encore à cet utilisateur`);
  }

  const sessions = await em.find(Session, { userId: target.id });
  const accounts = await em.find(Account, { userId: target.id });
  const grants = await em.find(ServerUser, { userId: target.id });
  em.remove(sessions);
  em.remove(accounts);
  em.remove(grants);
  em.remove(target);
  await em.flush();
}

// ─── Custom roles ─────────────────────────────────────────────────────────────

/** Slug id derived from the display name ("Support technique" → "support-technique"). */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Refuses reserved ids and id/name clashes. */
export async function assertNoClash(id: string, name: string): Promise<void> {
  if (PANEL_ROLES[id as PanelRoleName]) {
    throw new HttpError(409, `« ${id} » est un rôle intégré — choisis un autre nom`);
  }
  const byId = await orm.em.findOne(PanelRole, { id });
  if (byId) throw new HttpError(409, 'Un rôle utilise déjà cet identifiant');
  const byName = await orm.em.findOne(PanelRole, { name });
  if (byName) throw new HttpError(409, 'Un rôle utilise déjà ce nom');
}

/** A custom role may only grant a subset of the actor's own permissions. */
export async function assertWithinActorCeiling(
  grant: string[],
  actorRole: string,
): Promise<void> {
  const actorPermissions = await resolvePanelPermissions(actorRole);
  if (!isSubset(grant, actorPermissions)) {
    throw new HttpError(
      403,
      'Tu ne peux accorder que les permissions que tu possèdes toi-même',
    );
  }
}

/** Loads a custom role (404 when unknown). */
export async function requireRole(roleId: string) {
  const role = await orm.em.findOne(PanelRole, { id: roleId });
  if (!role) throw new HttpError(404, 'Rôle introuvable');
  return role;
}

/** Deletes a custom role — refused while users still carry it. */
export async function deleteRole(roleId: string): Promise<void> {
  const em = orm.em;
  const role = await requireRole(roleId);

  const assigned = await em.count(User, { role: roleId });
  if (assigned > 0) {
    throw new HttpError(409, `${assigned} utilisateur(s) ont encore ce rôle`);
  }

  em.remove(role);
  await em.flush();
}
