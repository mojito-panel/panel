import { Trash2 } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { SERVER_PERMISSION_GROUPS } from '~/lib/permissions';
import { defineList, field } from '~/lists/define';

/**
 * /servers/$serverId/users — sub-users of ONE server (Pelican "Users" tab).
 *
 * The list is scoped to a server at the query-builder level (the server id is a
 * route param, not a search param — see `listServerUsersFn`). The columns below
 * are what the table renders AND what the query may filter/sort on; the identity
 * of each row (`name`/`email`) is joined from the `user` table, so searching and
 * sorting by e-mail happen in SQL.
 */

/** Row of the per-server sub-users list (what the server function returns). */
export interface ServerSubuserRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  /** Flat permission strings of the grant ("server.files.read", …). */
  permissions: string[];
  createdAt: Date | null;
}

/** Row actions of the sub-users list, supplied by the page. */
export interface ServerSubusersContext {
  /** The viewer may edit/remove grants (`server.users` update/delete). */
  canManage: boolean;
  /** A row action is in flight (disables the buttons). */
  removing: boolean;
  onEdit: (subuser: ServerSubuserRow) => void;
  onRemove: (subuser: ServerSubuserRow) => void;
}

/** Flat permission → French label ("server.files.read" → "Fichiers · Voir"). */
const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  SERVER_PERMISSION_GROUPS.flatMap((group) =>
    group.actions.map(
      (entry) => [entry.permission, `${group.label} · ${entry.label}`] as const,
    ),
  ),
);

/** Number of permission chips shown before the rest is truncated. */
const SUMMARY_VISIBLE = 2;

/** Read-only summary of a grant: a count plus the first labels, truncated. */
function PermissionSummary({ permissions }: { permissions: string[] }) {
  if (permissions.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const labels = permissions.map((permission) => PERMISSION_LABELS[permission] ?? permission);
  const visible = labels.slice(0, SUMMARY_VISIBLE);
  const rest = labels.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="secondary">{permissions.length}</Badge>
      {visible.map((label, index) => (
        <Badge key={`${index}-${label}`} variant="outline">
          {label}
        </Badge>
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">+{rest}</span>}
    </div>
  );
}

export const serverSubusersList = defineList<ServerSubuserRow, ServerSubusersContext>({
  name: 'server-subusers',
  alias: 'su',
  defaultSort: { column: 'createdAt', desc: true },
  searchTargets: ['u.name', 'u.email'],
  joins: {
    u: { table: 'user', alias: 'u', left: 'id', right: 'su.user_id' },
  },
  columns: {
    user: {
      header: 'Utilisateur',
      sort: field('u.email'),
      cell: (subuser) => (
        <div>
          <p className="font-medium">{subuser.name}</p>
          <p className="text-xs text-muted-foreground">{subuser.email}</p>
        </div>
      ),
    },
    permissions: {
      header: 'Permissions',
      cell: (subuser) => <PermissionSummary permissions={subuser.permissions} />,
    },
    createdAt: {
      header: 'Ajouté le',
      sort: field('createdAt'),
      cell: (subuser) => (
        <span className="text-muted-foreground">
          {subuser.createdAt ? subuser.createdAt.toLocaleDateString('fr-FR') : '—'}
        </span>
      ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (subuser, context) =>
        context.canManage ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={context.removing}
              onClick={() => context.onEdit(subuser)}
            >
              Permissions
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={context.removing}
              onClick={() => context.onRemove(subuser)}
            >
              <Trash2 />
              Retirer
            </Button>
          </div>
        ) : null,
    },
  },
});
