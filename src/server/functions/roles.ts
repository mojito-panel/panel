import { createServerFn } from '@tanstack/react-start';
import type { EntityManager } from '@mikro-orm/core';
import { initOrm } from '~/db';
import { PanelRole, User } from '~/db/entities';
import { requirePanelPermission, HttpError, resolvePanelPermissions } from '../session';
import {
  PANEL_ROLES,
  PANEL_ROLE_NAMES,
  BUILT_IN_ROLE_LABELS,
  flattenPermissions,
  sanitizeStatements,
  isSubset,
  type PanelRoleName,
} from '~/lib/permissions';
import {
  createRoleSchema,
  updateRoleSchema,
  deleteRoleSchema,
} from '~/validators/role';

/**
 * Custom panel roles (Pelican-style, managed from /admin/roles) — CRUD on
 * the `role` table. Built-in roles (admin/moderator/user) stay code-defined
 * and are read-only.
 *
 * Escalation rule: a role may only carry permissions its creator also has
 * (`isSubset` against the actor's effective permissions) — the built-in
 * admin passes trivially since it holds the whole catalog.
 */

/** Slug id derived from the display name ("Support technique" → "support-technique"). */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
}

/** Refuses reserved ids and id/name clashes. */
async function assertNoClash(em: EntityManager, id: string, name: string): Promise<void> {
  if (PANEL_ROLES[id as PanelRoleName]) {
    throw new HttpError(409, `« ${id} » est un rôle intégré — choisis un autre nom`);
  }
  const byId = await em.findOne(PanelRole, { id });
  if (byId) throw new HttpError(409, 'Un rôle utilise déjà cet identifiant');
  const byName = await em.findOne(PanelRole, { name });
  if (byName) throw new HttpError(409, 'Un rôle utilise déjà ce nom');
}

/** A custom role may only grant a subset of the actor's own permissions. */
async function assertWithinActorCeiling(
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

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * All roles: built-ins (read-only, resolved from the code catalog) + custom
 * ones from the DB, with the user count of each. Also used by the Users
 * page's role picker — hence the OR on user.set-role.
 */
export const listRolesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requirePanelPermission({ 'panel.roles': ['read'], user: ['set-role'] }, 'OR');

  const orm = await initOrm();
  const em = orm.em.fork();
  const [roles, users] = await Promise.all([
    em.find(PanelRole, {}, { orderBy: { name: 'asc' } }),
    em.find(User, {}),
  ]);

  const userCountByRole = new Map<string, number>();
  for (const user of users) {
    const role = user.role ?? 'user';
    userCountByRole.set(role, (userCountByRole.get(role) ?? 0) + 1);
  }

  const builtIns = PANEL_ROLE_NAMES.map((name) => ({
    id: name,
    name: BUILT_IN_ROLE_LABELS[name],
    description: null as string | null,
    permissions: flattenPermissions(PANEL_ROLES[name].statements),
    userCount: userCountByRole.get(name) ?? 0,
    builtIn: true,
  }));

  const custom = roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description ?? null,
    permissions: flattenPermissions(sanitizeStatements(role.permissions ?? {})),
    userCount: userCountByRole.get(role.id) ?? 0,
    builtIn: false,
  }));

  return [...builtIns, ...custom];
});

// ─── Create ──────────────────────────────────────────────────────────────────

export const createRoleFn = createServerFn({ method: 'POST' })
  .validator(createRoleSchema)
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ 'panel.roles': ['create'] });

    const statements = sanitizeStatements(data.permissions);
    const grant = flattenPermissions(statements);
    if (grant.length === 0) {
      throw new HttpError(422, 'Sélectionne au moins une permission');
    }
    await assertWithinActorCeiling(grant, actor.role);

    const orm = await initOrm();
    const em = orm.em.fork();

    const id = slugify(data.name);
    if (!id) throw new HttpError(422, 'Nom invalide — impossible d’en dériver un identifiant');
    await assertNoClash(em, id, data.name);

    const now = new Date();
    const role = em.create(PanelRole, {
      id,
      name: data.name,
      description: data.description?.trim() ? data.description.trim() : null,
      permissions: statements,
      createdAt: now,
      updatedAt: now,
    });
    em.persist(role);
    await em.flush();

    return { id: role.id, name: role.name };
  });

// ─── Update ──────────────────────────────────────────────────────────────────

export const updateRoleFn = createServerFn({ method: 'POST' })
  .validator(updateRoleSchema)
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ 'panel.roles': ['update'] });

    if (PANEL_ROLES[data.roleId as PanelRoleName]) {
      throw new HttpError(409, 'Les rôles intégrés ne sont pas modifiables');
    }

    const orm = await initOrm();
    const em = orm.em.fork();
    const role = await em.findOne(PanelRole, { id: data.roleId });
    if (!role) throw new HttpError(404, 'Rôle introuvable');

    const statements = sanitizeStatements(data.permissions);
    const grant = flattenPermissions(statements);
    if (grant.length === 0) {
      throw new HttpError(422, 'Sélectionne au moins une permission');
    }
    await assertWithinActorCeiling(grant, actor.role);

    if (role.name !== data.name) {
      const byName = await em.findOne(PanelRole, { name: data.name });
      if (byName) throw new HttpError(409, 'Un rôle utilise déjà ce nom');
      role.name = data.name;
    }
    role.description = data.description?.trim() ? data.description.trim() : null;
    role.permissions = statements;
    await em.flush();

    return { id: role.id, name: role.name };
  });

// ─── Delete (refused while users still carry the role) ───────────────────────

export const deleteRoleFn = createServerFn({ method: 'POST' })
  .validator(deleteRoleSchema)
  .handler(async ({ data }) => {
    await requirePanelPermission({ 'panel.roles': ['delete'] });

    if (PANEL_ROLES[data.roleId as PanelRoleName]) {
      throw new HttpError(409, 'Les rôles intégrés ne sont pas supprimables');
    }

    const orm = await initOrm();
    const em = orm.em.fork();
    const role = await em.findOne(PanelRole, { id: data.roleId });
    if (!role) throw new HttpError(404, 'Rôle introuvable');

    const assigned = await em.count(User, { role: data.roleId });
    if (assigned > 0) {
      throw new HttpError(409, `${assigned} utilisateur(s) ont encore ce rôle`);
    }

    em.remove(role);
    await em.flush();
    return { deleted: true };
  });
