import { z } from 'zod';
import {
  createAccessControl,
  role as makeRole,
  type Role,
} from 'better-auth/plugins/access';
import type { Permission, SftpPermission } from '~/contract';

/**
 * Panel access control — Pelican-style permissions built on better-auth's
 * access-control primitives (`createAccessControl` / `role`, see
 * https://better-auth.com/docs/plugins/admin#access-control).
 *
 * Two permission families, both checked with the SAME `can()` util:
 *
 * - **Panel-level** (`user`, `session`, `panel.*`): attached to the user's
 *   `role` (admin / moderator / user). The `user`/`session` resources are the
 *   ones the better-auth admin plugin checks on its own endpoints.
 * - **Server-level** (`server.*`): attached per server. The owner (and the
 *   admin role) always holds the full set; other users get a `server_user`
 *   grant row (the Pelican "sub-user" equivalent).
 *
 * This module is PURE TypeScript — safe to import from client and server
 * code alike. It never touches the DB.
 */

// ─── Statements (the full permission catalog) ────────────────────────────────

export const statement = {
  // better-auth admin plugin endpoints (list/create/ban users, sessions…)
  user: [
    'create',
    'list',
    'get',
    'update',
    'delete',
    'set-role',
    'ban',
    'set-password',
    'set-email',
    'impersonate',
    'impersonate-admins',
  ],
  session: ['list', 'revoke', 'delete'],

  // Admin area of the panel (Pelican "panel permissions")
  'panel.overview': ['read'],
  'panel.nodes': ['read', 'create', 'update', 'delete'],
  'panel.recipes': ['read', 'create', 'update', 'delete'],
  'panel.roles': ['read', 'create', 'update', 'delete'],
  'panel.servers': ['read', 'update', 'delete'],

  // Per-server (Pelican "server permissions", granted to sub-users)
  'server.console': ['read', 'command'],
  'server.power': ['start', 'stop', 'restart', 'kill'],
  'server.files': ['read', 'write', 'create', 'delete'],
  'server.variables': ['read', 'update'],
  'server.network': ['read', 'update'],
  'server.settings': ['read', 'update'],
  'server.users': ['read', 'create', 'update', 'delete'],
  'server.backups': ['read', 'create', 'restore', 'delete'],
  'server.schedules': ['read', 'create', 'update', 'delete'],
  'server.activity': ['read'],
} as const;

/** Serializable statements shape (what a `server_user`/`role` permissions JSON holds). */
export type PermissionStatements = Record<string, string[]>;

/** Read-only statements source (a role's `statements`, DB JSON, `as const` catalogs). */
export type ReadonlyPermissionStatements = Record<string, readonly string[]>;

/** Requested actions of one resource — an array (AND) or an object form. */
export type PermissionActionsRequest =
  | readonly string[]
  | { actions: readonly string[]; connector?: 'AND' | 'OR' };

/** A permission request: resources → action requests (checked AND or OR). */
export type PermissionRequest = Record<string, PermissionActionsRequest>;

export const ac = createAccessControl(statement);

/**
 * Panel-level statements a CUSTOM role may carry (the `role` table) —
 * everything except the per-server family, which belongs to sub-user grants.
 */
export function panelRoleStatements(): PermissionStatements {
  const out: PermissionStatements = {};
  for (const [resource, actions] of Object.entries(statement)) {
    if (!resource.startsWith('server.')) out[resource] = [...actions];
  }
  return out;
}

/** All `server.*` statements as a PermissionStatements record. */
function allServerStatements(): PermissionStatements {
  const out: PermissionStatements = {};
  for (const [resource, actions] of Object.entries(statement)) {
    if (resource.startsWith('server.')) out[resource] = [...actions];
  }
  return out;
}

// ─── Panel roles (user.role column) ────────────────────────────────────────

export const adminRole = ac.newRole({
  user: [...statement.user],
  session: [...statement.session],
  'panel.overview': [...statement['panel.overview']],
  'panel.nodes': [...statement['panel.nodes']],
  'panel.recipes': [...statement['panel.recipes']],
  'panel.roles': [...statement['panel.roles']],
  'panel.servers': [...statement['panel.servers']],
  ...allServerStatements(),
});

/** Moderator (Pelican-style): read-only oversight of the admin area. */
export const moderatorRole = ac.newRole({
  user: ['list', 'get'],
  'panel.overview': ['read'],
  'panel.nodes': ['read'],
  'panel.recipes': ['read'],
  'panel.roles': ['read'],
  'panel.servers': ['read'],
});

/** Plain user: no panel-level permission — only their own (or shared) servers. */
export const userRole = ac.newRole({});

/**
 * Built-in roles — ALWAYS available, NOT editable/deletable (they anchor
 * the panel: the admin role holds every permission, the user role is the
 * baseline of every account). Custom roles live in the `role` table and
 * are managed from /admin/roles, like Pelican.
 */
export const PANEL_ROLES = {
  admin: adminRole,
  moderator: moderatorRole,
  user: userRole,
} as const satisfies Record<string, Role>;

export type PanelRoleName = keyof typeof PANEL_ROLES;

export const PANEL_ROLE_NAMES = Object.keys(PANEL_ROLES) as PanelRoleName[];

/**
 * Role of a user by `role` column — resolves BUILT-IN roles only; a custom
 * role id (or an unknown name) degrades to the plain user role. Server-side
 * panel checks go through `resolvePanelRole` (session.ts), which consults
 * the `role` table first.
 */
export function panelRole(name: string): Role {
  return PANEL_ROLES[name as PanelRoleName] ?? userRole;
}

/** French display metadata of the built-in roles (read-only in the UI). */
export const BUILT_IN_ROLE_LABELS: Record<PanelRoleName, string> = {
  admin: 'Administrateur',
  moderator: 'Modérateur',
  user: 'Utilisateur',
};

// ─── Server roles (owner / admin / sub-user grant) ──────────────────────────

/** Full server permission set — owners and the admin role hold it implicitly. */
export const ownerRole = ac.newRole(allServerStatements());

/**
 * Role built from a stored sub-user grant (`server_user.permissions`).
 * Unknown resources/actions are dropped by `sanitizeStatements`.
 */
export function subuserRole(permissions: ReadonlyPermissionStatements): Role {
  return makeRole(sanitizeStatements(permissions));
}

// ─── Check utils (server AND client) ───────────────────────────────────────

/** Checks a role against a request — true when authorized. */
export function can(
  role: Role,
  request: PermissionRequest,
  connector: 'AND' | 'OR' = 'AND',
): boolean {
  // Cast: our request type accepts readonly arrays, better-auth's
  // RoleAuthorizeRequest requires mutable ones (runtime-compatible)
  return role.authorize(request as never, connector).success;
}

/**
 * Checks a FLAT permission list ("panel.nodes.read") against a request —
 * works for panel-level grants (session user, custom roles) AND per-server
 * sub-user grants.
 */
export function canFromPermissions(
  permissions: string[],
  request: PermissionRequest,
  connector: 'AND' | 'OR' = 'AND',
): boolean {
  return can(subuserRole(parsePermissions(permissions)), request, connector);
}

/** Per-server grant check — alias of `canFromPermissions`, for readability. */
export const serverCan = canFromPermissions;

/** Entry ticket to the /admin area: any panel-level read permission. */
export function hasAdminAreaAccess(permissions: string[]): boolean {
  return canFromPermissions(
    permissions,
    {
      'panel.overview': ['read'],
      'panel.nodes': ['read'],
      'panel.recipes': ['read'],
      'panel.roles': ['read'],
      'panel.servers': ['read'],
      user: ['list'],
    },
    'OR',
  );
}

// ─── Flat permission strings ("server.files.read") ──────────────────────────

/** Flattens statements into dot-joined permission strings. */
export function flattenPermissions(statements: ReadonlyPermissionStatements): string[] {
  const out: string[] = [];
  for (const [resource, actions] of Object.entries(statements)) {
    for (const action of actions) out.push(`${resource}.${action}`);
  }
  return out;
}

/** Full flat server permission list (owners / admins). */
export const ALL_SERVER_PERMISSIONS = flattenPermissions(allServerStatements());

/**
 * Parses flat permission strings back into statements. The LAST dot splits
 * resource from action (resources contain one dot, actions none) — anything
 * unknown is dropped.
 */
export function parsePermissions(flat: string[]): PermissionStatements {
  return sanitizeStatements(
    flat.reduce<PermissionStatements>((acc, permission) => {
      const index = permission.lastIndexOf('.');
      if (index <= 0) return acc;
      const resource = permission.slice(0, index);
      const action = permission.slice(index + 1);
      (acc[resource] ??= []).push(action);
      return acc;
    }, {}),
  );
}

/**
 * Clamps raw statements to the catalog: keeps only known resources and, for
 * each, only declared actions. Used on anything coming out of storage
 * (`server_user.permissions`) or over the wire.
 */
export function sanitizeStatements(
  input: ReadonlyPermissionStatements,
): PermissionStatements {
  const out: PermissionStatements = {};
  for (const [resource, actions] of Object.entries(input)) {
    const catalog = (statement as Record<string, readonly string[]>)[resource];
    if (!catalog || !Array.isArray(actions)) continue;
    const allowed = actions.filter((action) =>
      (catalog as readonly string[]).includes(action),
    );
    if (allowed.length > 0) out[resource] = allowed;
  }
  return out;
}

/** True when every permission of `candidate` is also in `of` (Pelican sub-user rule). */
export function isSubset(candidate: string[], of: string[]): boolean {
  const granted = new Set(of);
  return candidate.every((permission) => granted.has(permission));
}

// ─── Zod schemas (wire + storage formats) ───────────────────────────────────

const serverResourceEntries = Object.entries(statement).filter(([resource]) =>
  resource.startsWith('server.'),
);

const panelResourceEntries = Object.entries(statement).filter(
  ([resource]) => !resource.startsWith('server.'),
);

function permissionsSchemaOf(entries: [string, readonly string[]][]) {
  return z.strictObject(
    Object.fromEntries(
      entries.map(([resource, actions]) => [
        resource,
        z.array(z.enum(actions as unknown as [string, ...string[]])).optional(),
      ]),
    ),
  ) as z.ZodType<PermissionStatements>;
}

/**
 * Schema of the permissions object stored in `server_user.permissions` and
 * exchanged with the UI: ONLY `server.*` resources (strict — unknown keys
 * are rejected), only declared actions.
 */
export const subuserPermissionsSchema = permissionsSchemaOf(serverResourceEntries);

/**
 * Schema of the permissions object stored in `role.permissions` (custom
 * panel roles): ONLY panel-level resources (`panel.*`, `user`, `session`) —
 * a role never carries per-server permissions, those are sub-user grants.
 */
export const rolePermissionsSchema = permissionsSchemaOf(panelResourceEntries);

// ─── SFTP permission mapping (panel grants → agent file.* permissions) ─────

/** Panel server permission → agent-side SFTP permissions (wings file.* list). */
const SFTP_PERMISSION_MAP: Record<string, SftpPermission[]> = {
  'server.files.read': ['file.read', 'file.read-content'],
  'server.files.write': ['file.update'],
  'server.files.create': ['file.create'],
  'server.files.delete': ['file.delete'],
};

/**
 * Maps the viewer's flat server permissions onto the SFTP permission list
 * enforced by the agent per operation. Owners/admins bypass this — the
 * panel answers `"*"` for them instead (Pelican GetUserPermissionsService).
 * An empty result means: no SFTP access at all.
 */
export function toSftpPermissions(permissions: string[]): SftpPermission[] {
  const out = new Set<SftpPermission>();
  for (const permission of permissions) {
    for (const mapped of SFTP_PERMISSION_MAP[permission] ?? []) out.add(mapped);
  }
  return [...out];
}

// ─── Console JWT mapping (panel permissions → contract agent permissions) ───

/** Panel server permission → agent-side console JWT permission. */
const CONSOLE_PERMISSION_MAP: Record<string, Permission> = {
  'server.console.read': 'console.read',
  'server.console.command': 'console.write',
  'server.power.start': 'power.start',
  'server.power.stop': 'power.stop',
  'server.power.restart': 'power.restart',
  'server.power.kill': 'power.kill',
  'server.variables.read': 'variables.read',
  'server.variables.update': 'variables.write',
};

/**
 * Maps the viewer's flat server permissions onto the agent's console JWT
 * permission list (the agent enforces these on every WS message).
 */
export function toConsolePermissions(permissions: string[]): Permission[] {
  const out = new Set<Permission>();
  for (const permission of permissions) {
    const mapped = CONSOLE_PERMISSION_MAP[permission];
    if (mapped) out.add(mapped);
  }
  return [...out];
}

// ─── UI metadata (sub-user + role permission editors) ───────────────────────

/** Action labels of a resource, French UI. */
const ACTION_LABELS: Record<string, string> = {
  read: 'Voir',
  command: 'Envoyer des commandes',
  write: 'Modifier',
  create: 'Créer',
  update: 'Mettre à jour',
  delete: 'Supprimer',
  start: 'Démarrer',
  stop: 'Arrêter',
  restart: 'Redémarrer',
  kill: 'Forcer l’arrêt',
  restore: 'Restaurer',
  list: 'Lister',
  get: 'Consulter',
  'set-role': 'Changer le rôle',
  ban: 'Suspendre',
  'set-password': 'Définir le mot de passe',
  'set-email': 'Changer l’e-mail',
  impersonate: 'Imiter un compte',
  'impersonate-admins': 'Imiter un administrateur',
  revoke: 'Révoquer',
};

const RESOURCE_LABELS: Record<string, string> = {
  // Per-server (sub-user grants)
  'server.console': 'Console',
  'server.power': 'Alimentation',
  'server.files': 'Fichiers',
  'server.variables': 'Variables',
  'server.network': 'Réseau',
  'server.settings': 'Paramètres',
  'server.users': 'Utilisateurs',
  'server.backups': 'Sauvegardes',
  'server.schedules': 'Planifications',
  'server.activity': 'Activité',
  // Panel-level (custom roles)
  'panel.overview': 'Vue d’ensemble (admin)',
  'panel.nodes': 'Nodes',
  'panel.recipes': 'Recettes',
  'panel.roles': 'Rôles',
  'panel.servers': 'Serveurs',
  user: 'Comptes utilisateurs',
  session: 'Sessions',
};

/** Catalog of server permissions for the sub-user editor, in display order. */
export const SERVER_PERMISSION_GROUPS = serverResourceEntries.map(
  ([resource, actions]) => ({
    resource,
    label: RESOURCE_LABELS[resource] ?? resource,
    actions: actions.map((action) => ({
      action,
      label: ACTION_LABELS[action] ?? action,
      // Flat permission string — the wire format
      permission: `${resource}.${action}`,
    })),
  }),
);

/** Catalog of panel-level permissions for the custom role editor. */
export const PANEL_PERMISSION_GROUPS = panelResourceEntries.map(
  ([resource, actions]) => ({
    resource,
    label: RESOURCE_LABELS[resource] ?? resource,
    actions: actions.map((action) => ({
      action,
      label: ACTION_LABELS[action] ?? action,
      permission: `${resource}.${action}`,
    })),
  }),
);
