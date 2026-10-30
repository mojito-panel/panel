import { createServerFn } from '@tanstack/react-start';

import { PanelRole, User } from '~/db/entities';
import {
  PANEL_ROLES,
  PANEL_ROLE_NAMES,
  BUILT_IN_ROLE_LABELS,
  flattenPermissions,
  sanitizeStatements,
  type PanelRoleName,
} from '~/lib/permissions';
import { createRoleSchema, updateRoleSchema, deleteRoleSchema } from '~/validators/role';

import { logActivity } from '../activity';
import { withOrmContext } from '../middleware';
import { orm } from '../orm';
import { requirePanelPermission, HttpError } from '../session';
import {
  slugify,
  assertNoClash,
  assertWithinActorCeiling,
  requireRole,
  deleteRole,
} from '../users';

/**
 * Custom panel roles (Pelican-style, managed from /admin/roles) — CRUD on
 * the `role` table. A custom role only carries PANEL-level statements and
 * only a subset of its creator's own permissions (`isSubset` against the
 * actor's effective permissions — the built-in admin is the ceiling).
 */

// ─── List ────────────────────────────────────────────────────────────────────

/**
 * All roles: built-ins (read-only, resolved from the code catalog) + custom
 * ones from the DB, with the user count of each. Also used by the Users
 * page's role picker — hence the OR on user.set-role.
 */
export const listRolesFn = createServerFn({ method: 'GET' })
  .middleware([withOrmContext])
  .handler(async () => {
    await requirePanelPermission({ 'panel.roles': ['read'], user: ['set-role'] }, 'OR');

    const [roles, users] = await Promise.all([
      orm.em.find(PanelRole, {}, { orderBy: { name: 'asc' } }),
      orm.em.find(User, {}),
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
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ 'panel.roles': ['create'] });

    const statements = sanitizeStatements(data.permissions);
    const grant = flattenPermissions(statements);
    if (grant.length === 0) {
      throw new HttpError(422, 'Sélectionne au moins une permission');
    }
    await assertWithinActorCeiling(grant, actor.role);

    const id = slugify(data.name);
    if (!id) throw new HttpError(422, 'Nom invalide — impossible d’en dériver un identifiant');
    await assertNoClash(id, data.name);

    const em = orm.em;
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

    await logActivity({
      event: 'role:create',
      description: `Rôle « ${role.name} » créé`,
      actor: { id: actor.id, name: actor.name, email: actor.email },
      properties: { roleId: role.id, permissions: grant },
    });

    return { id: role.id, name: role.name };
  });

// ─── Update ──────────────────────────────────────────────────────────────────

export const updateRoleFn = createServerFn({ method: 'POST' })
  .validator(updateRoleSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const actor = await requirePanelPermission({ 'panel.roles': ['update'] });

    if (PANEL_ROLES[data.roleId as PanelRoleName]) {
      throw new HttpError(409, 'Les rôles intégrés ne sont pas modifiables');
    }

    const role = await requireRole(data.roleId);

    const statements = sanitizeStatements(data.permissions);
    const grant = flattenPermissions(statements);
    if (grant.length === 0) {
      throw new HttpError(422, 'Sélectionne au moins une permission');
    }
    await assertWithinActorCeiling(grant, actor.role);

    if (role.name !== data.name) {
      const byName = await orm.em.findOne(PanelRole, { name: data.name });
      if (byName) throw new HttpError(409, 'Un rôle utilise déjà ce nom');
      role.name = data.name;
    }
    role.description = data.description?.trim() ? data.description.trim() : null;
    role.permissions = statements;
    await orm.em.flush();

    await logActivity({
      event: 'role:update',
      description: `Rôle « ${role.name} » modifié`,
      actor: { id: actor.id, name: actor.name, email: actor.email },
      properties: { roleId: role.id, permissions: grant },
    });

    return { id: role.id, name: role.name };
  });

// ─── Delete (refused while users still carry the role) ───────────────────────

export const deleteRoleFn = createServerFn({ method: 'POST' })
  .validator(deleteRoleSchema)
  .middleware([withOrmContext])
  .handler(async ({ data }) => {
    const user = await requirePanelPermission({ 'panel.roles': ['delete'] });

    if (PANEL_ROLES[data.roleId as PanelRoleName]) {
      throw new HttpError(409, 'Les rôles intégrés ne sont pas supprimables');
    }

    const role = await requireRole(data.roleId);
    await deleteRole(data.roleId);
    await logActivity({
      event: 'role:delete',
      description: `Rôle « ${role.name} » supprimé`,
      actor: { id: user.id, name: user.name, email: user.email },
      properties: { roleId: role.id },
    });
    return { deleted: true };
  });
