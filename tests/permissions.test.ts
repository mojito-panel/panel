import { describe, it, expect } from 'vitest';

import {
  statement,
  adminRole,
  moderatorRole,
  userRole,
  ownerRole,
  PANEL_ROLES,
  PANEL_ROLE_NAMES,
  BUILT_IN_ROLE_LABELS,
  panelRole,
  can,
  hasPermissions,
  hasServerPermissions,
  hasAdminAreaAccess,
  flattenPermissions,
  parsePermissions,
  sanitizeStatements,
  subuserRole,
  ALL_SERVER_PERMISSIONS,
  isSubset,
  subuserPermissionsSchema,
  rolePermissionsSchema,
  toConsolePermissions,
  SERVER_PERMISSION_GROUPS,
  PANEL_PERMISSION_GROUPS,
} from '~/lib/permissions';

/**
 * Permission utils tests — pure access-control logic (better-auth
 * `createAccessControl`/`role` primitives, Pelican-style statements).
 */

describe('panel roles', () => {
  it('grants the admin role every statement of the catalog', () => {
    for (const [resource, actions] of Object.entries(statement)) {
      // Indexing by a plain string key — ExactRoleStatements has no index
      // signature (type-level only, the values are the same at runtime).
      expect((adminRole.statements as Record<string, readonly string[]>)[resource]).toEqual([
        ...actions,
      ]);
    }
  });

  it('gives the moderator read-only oversight of the admin area', () => {
    expect(can(moderatorRole, { 'panel.overview': ['read'] })).toBe(true);
    expect(can(moderatorRole, { 'panel.nodes': ['read'] })).toBe(true);
    expect(can(moderatorRole, { 'panel.recipes': ['read'] })).toBe(true);
    expect(can(moderatorRole, { 'panel.servers': ['read'] })).toBe(true);
    // better-auth admin plugin endpoints (list users, get user)
    expect(can(moderatorRole, { user: ['list', 'get'] })).toBe(true);
    // No write access at all
    expect(can(moderatorRole, { 'panel.nodes': ['create'] })).toBe(false);
    expect(can(moderatorRole, { 'panel.recipes': ['update'] })).toBe(false);
    // Server creation is an admin feature — NOT part of the read-only oversight
    expect(can(moderatorRole, { 'panel.servers': ['create'] })).toBe(false);
    expect(can(moderatorRole, { user: ['set-role'] })).toBe(false);
    expect(can(moderatorRole, { user: ['ban'] })).toBe(false);
    // The panel-wide activity log aggregates every server's events —
    // moderator does NOT see it (Pelican parity), admin does.
    expect(can(moderatorRole, { 'panel.activity': ['read'] })).toBe(false);
    expect(can(adminRole, { 'panel.activity': ['read'] })).toBe(true);
    // No per-server permissions via the panel role
    expect(can(moderatorRole, { 'server.files': ['read'] })).toBe(false);
  });

  it('gives the plain user role nothing', () => {
    expect(can(userRole, { 'panel.overview': ['read'] })).toBe(false);
    expect(can(userRole, { user: ['list'] })).toBe(false);
    expect(can(userRole, { 'server.files': ['read'] })).toBe(false);
    // Server creation is an admin feature (panel.servers.create)
    expect(can(userRole, { 'panel.servers': ['create'] })).toBe(false);
  });

  it('exposes the full server permission set to owners', () => {
    expect(can(ownerRole, { 'server.files': ['read', 'write', 'create', 'delete'] })).toBe(true);
    expect(can(ownerRole, { 'server.users': ['create', 'read', 'update', 'delete'] })).toBe(true);
    // The owner role carries NO panel-level permission
    expect(can(ownerRole, { 'panel.nodes': ['read'] })).toBe(false);
  });
});

describe('can()', () => {
  it('requires EVERY requested action with the AND connector', () => {
    const subuser = subuserRole({ 'server.files': ['read', 'write'] });
    expect(can(subuser, { 'server.files': ['read', 'write'] })).toBe(true);
    expect(can(subuser, { 'server.files': ['read', 'delete'] })).toBe(false);
  });

  it('requires ANY requested resource with the OR connector (AND within a resource)', () => {
    const subuser = subuserRole({ 'server.files': ['read'], 'server.console': ['read'] });
    // OR across resources — one authorized resource is enough
    expect(can(subuser, { 'server.files': ['write'], 'server.console': ['read'] }, 'OR')).toBe(
      true,
    );
    // No authorized resource at all
    expect(can(subuser, { 'server.files': ['write'], 'server.power': ['start'] }, 'OR')).toBe(
      false,
    );
    // Inside ONE resource, an array still means AND (better-auth semantics)
    expect(can(subuser, { 'server.files': ['read', 'write'] }, 'OR')).toBe(false);
    // Object form — OR inside a single resource
    expect(can(subuser, { 'server.files': { actions: ['read', 'write'], connector: 'OR' } })).toBe(
      true,
    );
  });

  it('refuses requests on resources the role does not know', () => {
    expect(can(userRole, { 'unknown.resource': ['read'] })).toBe(false);
  });

  it('hasPermissions checks a flat grant list (panel AND per-server grants)', () => {
    const adminPermissions = flattenPermissions(adminRole.statements);
    expect(hasPermissions(adminPermissions, { 'panel.nodes': ['create'] })).toBe(true);
    expect(hasPermissions(adminPermissions, { user: ['set-role'] })).toBe(true);
    expect(hasPermissions([], { 'panel.nodes': ['create'] })).toBe(false);
    expect(hasPermissions(['server.files.read'], { 'server.files': ['read'] })).toBe(true);
    expect(hasPermissions(['server.files.read'], { 'panel.nodes': ['create'] })).toBe(false);
  });
});

describe('hasAdminAreaAccess()', () => {
  it('lets effective permissions decide — not the role name', () => {
    expect(hasAdminAreaAccess(flattenPermissions(adminRole.statements))).toBe(true);
    expect(hasAdminAreaAccess(flattenPermissions(moderatorRole.statements))).toBe(true);
    expect(hasAdminAreaAccess(flattenPermissions(userRole.statements))).toBe(false);
    expect(hasAdminAreaAccess([])).toBe(false);
    // A custom role (built from a DB grant) with a panel read permission enters
    expect(hasAdminAreaAccess(['panel.nodes.read'])).toBe(true);
    // Per-server permissions alone do NOT open the admin area
    expect(hasAdminAreaAccess(ALL_SERVER_PERMISSIONS)).toBe(false);
  });
});

describe('flat permission strings', () => {
  it('flattens and parses back (round trip)', () => {
    const statements = {
      'server.files': ['read', 'write'],
      'server.console': ['read'],
    };
    expect(parsePermissions(flattenPermissions(statements))).toEqual(statements);
  });

  it('drops unknown resources and actions while parsing', () => {
    const parsed = parsePermissions([
      'server.files.read',
      'server.files.explode',
      'server.unknown.read',
      'malformed',
      'unknown.thing.read',
    ]);
    expect(parsed).toEqual({ 'server.files': ['read'] });
  });

  it('sanitizes raw statements against the catalog', () => {
    expect(
      sanitizeStatements({
        'server.files': ['read', 'hack'],
        'server.hack': ['read'],
        'panel.nodes': ['create'],
      }),
    ).toEqual({
      'server.files': ['read'],
      'panel.nodes': ['create'],
    });
  });

  it('lists every server.* permission for owners/admins', () => {
    const expected = Object.entries(statement)
      .filter(([resource]) => resource.startsWith('server.'))
      .flatMap(([resource, actions]) => actions.map((action) => `${resource}.${action}`));
    expect(ALL_SERVER_PERMISSIONS.sort()).toEqual([...expected].sort());
  });
});

describe('hasServerPermissions() (sub-user grants)', () => {
  it('checks the viewer grant from the flat list', () => {
    const grant = ['server.console.read', 'server.console.command', 'server.power.start'];
    expect(hasServerPermissions(grant, { 'server.console': ['read'] })).toBe(true);
    expect(hasServerPermissions(grant, { 'server.console': ['command'] })).toBe(true);
    expect(hasServerPermissions(grant, { 'server.power': ['start'] })).toBe(true);
    expect(hasServerPermissions(grant, { 'server.power': ['kill'] })).toBe(false);
    expect(hasServerPermissions(grant, { 'server.files': ['read'] })).toBe(false);
  });

  it('returns false for an empty grant', () => {
    expect(hasServerPermissions([], { 'server.files': ['read'] })).toBe(false);
  });
});

describe('isSubset()', () => {
  it('detects whether a grant stays within the actor ceiling', () => {
    const ceiling = ['server.files.read', 'server.files.write', 'server.console.read'];
    expect(isSubset(['server.files.read'], ceiling)).toBe(true);
    expect(isSubset(['server.files.read', 'server.files.delete'], ceiling)).toBe(false);
    expect(isSubset([], ceiling)).toBe(true);
  });
});

describe('subuserPermissionsSchema', () => {
  it('accepts a valid grant and rejects unknown values', () => {
    const valid = { 'server.files': ['read', 'write'] };
    expect(subuserPermissionsSchema.parse(valid)).toEqual(valid);

    expect(() => subuserPermissionsSchema.parse({ 'server.files': ['read', 'hack'] })).toThrow();
    expect(() => subuserPermissionsSchema.parse({ 'server.hack': ['read'] })).toThrow();
    // Panel-level resources are NOT grantable to a sub-user
    expect(() => subuserPermissionsSchema.parse({ 'panel.nodes': ['create'] })).toThrow();
  });
});

describe('toConsolePermissions()', () => {
  it('maps panel permissions onto the agent console JWT permissions', () => {
    expect(
      toConsolePermissions([
        'server.console.read',
        'server.console.command',
        'server.power.start',
        'server.power.kill',
        'server.variables.read',
        'server.variables.update',
        // Not console-related — must NOT leak into the token
        'server.files.read',
      ]).sort(),
    ).toEqual(
      [
        'console.read',
        'console.write',
        'power.start',
        'power.kill',
        'variables.read',
        'variables.write',
      ].sort(),
    );
  });

  it('returns an empty list for a viewer without console permissions', () => {
    expect(toConsolePermissions(['server.files.read'])).toEqual([]);
  });
});

describe('SERVER_PERMISSION_GROUPS (sub-user editor catalog)', () => {
  it('covers exactly the server.* statements of the catalog', () => {
    const grouped = SERVER_PERMISSION_GROUPS.flatMap((group) =>
      group.actions.map((action) => action.permission),
    );
    const expected = flattenPermissions(
      Object.fromEntries(
        Object.entries(statement).filter(([resource]) => resource.startsWith('server.')),
      ),
    );
    expect(grouped.sort()).toEqual(expected.sort());
  });
});

describe('PANEL_PERMISSION_GROUPS (custom role editor catalog)', () => {
  it('covers exactly the non-server statements of the catalog', () => {
    const grouped = PANEL_PERMISSION_GROUPS.flatMap((group) =>
      group.actions.map((action) => action.permission),
    );
    const expected = flattenPermissions(
      Object.fromEntries(
        Object.entries(statement).filter(([resource]) => !resource.startsWith('server.')),
      ),
    );
    expect(grouped.sort()).toEqual(expected.sort());
  });
});

describe('rolePermissionsSchema (custom panel roles)', () => {
  it('accepts panel-level statements', () => {
    const valid = { 'panel.nodes': ['read', 'create'], user: ['list'] };
    expect(rolePermissionsSchema.parse(valid)).toEqual(valid);
  });

  it('accepts the panel-wide activity statement (custom roles may be granted it)', () => {
    expect(rolePermissionsSchema.parse({ 'panel.activity': ['read'] })).toEqual({
      'panel.activity': ['read'],
    });
  });

  it('rejects per-server permissions — those are sub-user grants, never roles', () => {
    expect(() => rolePermissionsSchema.parse({ 'server.files': ['read'] })).toThrow();
  });

  it('rejects unknown actions', () => {
    expect(() => rolePermissionsSchema.parse({ user: ['list', 'hack'] })).toThrow();
  });
});

describe('built-in roles invariants', () => {
  it('registers exactly admin / moderator / user, each with a French label', () => {
    expect(PANEL_ROLE_NAMES.sort()).toEqual(['admin', 'moderator', 'user']);
    for (const name of PANEL_ROLE_NAMES) {
      expect(BUILT_IN_ROLE_LABELS[name].length).toBeGreaterThan(0);
    }
  });

  it('degrades unknown role names to the plain user role (custom ids resolve server-side)', () => {
    expect(panelRole('some-custom-role-id')).toBe(userRole);
    expect(panelRole('moderator')).toBe(PANEL_ROLES.moderator);
  });

  it('gives the moderator read-only roles oversight (panel.roles.read)', () => {
    expect(can(moderatorRole, { 'panel.roles': ['read'] })).toBe(true);
    expect(can(moderatorRole, { 'panel.roles': ['create'] })).toBe(false);
    expect(can(adminRole, { 'panel.roles': ['create', 'update', 'delete'] })).toBe(true);
  });
});
