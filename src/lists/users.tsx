import { Ban, CircleCheck, Trash2 } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { defineList, field } from '~/lists/define';

/**
 * /admin/users — panel accounts (roles, suspension, deletion).
 *
 * One definition for the whole page: the columns below are what the table
 * renders AND what the query may filter/sort on. Search/filter/sort/pagination
 * all run in the database; the per-page server count is resolved in SQL by the
 * list server function, never by loading every server into memory.
 */

/** Row of the admin users list (what the server function returns). */
export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  username: string | null;
  role: string;
  roleName: string;
  banned: boolean;
  serverCount: number;
  createdAt: Date;
}

/** Row actions of the admin users list, supplied by the page. */
export interface AdminUsersContext {
  canSetRole: boolean;
  canBan: boolean;
  canDelete: boolean;
  /** Role picker entries (built-ins + custom roles from `listRolesFn`). */
  roles: { id: string; name: string }[];
  /** A row action is in flight (disables the buttons). */
  busy: boolean;
  /** True for the acting user's own row — self-lockout guard, never acted on. */
  isSelf: (user: AdminUserRow) => boolean;
  onRoleChange: (user: AdminUserRow, roleId: string) => void;
  onBan: (user: AdminUserRow) => void;
  onUnban: (user: AdminUserRow) => void;
  onDelete: (user: AdminUserRow) => void;
}

export const adminUsersList = defineList<AdminUserRow, AdminUsersContext>({
  name: 'admin-users',
  alias: 'u',
  defaultSort: { column: 'createdAt', desc: true },
  searchTargets: ['email', 'name', 'username'],
  columns: {
    user: {
      header: 'Utilisateur',
      sort: field('name'),
      cell: (user) => (
        <div>
          <p className="font-medium">{user.name ?? '—'}</p>
          <p className="text-muted-foreground text-xs">{user.email}</p>
        </div>
      ),
    },
    role: {
      header: 'Rôle',
      // Options come from the page (custom roles live in the database).
      filter: { control: 'choice', target: field('role'), dynamic: true },
      cell: (user, context) =>
        context?.canSetRole && !context.isSelf(user) ? (
          <Select
            value={user.role}
            onValueChange={(role) => role !== null && context.onRoleChange(user, role)}
          >
            <SelectTrigger className="w-44">
              {/* base-ui only resolves an item's LABEL once that item is mounted
                  (i.e. after the popup opened) — a closed trigger would show the
                  raw value, so the label is resolved here. */}
              <SelectValue>
                {(current: string | null) =>
                  context.roles.find((role) => role.id === current)?.name ??
                  current ??
                  user.roleName
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {context.roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span>{user.roleName}</span>
        ),
    },
    servers: {
      header: 'Serveurs',
      cell: (user) => user.serverCount,
    },
    status: {
      header: 'Statut',
      filter: { control: 'boolean', target: field('banned') },
      cell: (user) =>
        user.banned ? (
          <span className="border-destructive/50 text-destructive rounded-full border px-2 py-0.5 text-xs">
            Suspendu
          </span>
        ) : (
          <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
            Actif
          </span>
        ),
    },
    createdAt: {
      header: 'Créé le',
      sort: field('createdAt'),
      cell: (user) => (
        <span className="text-muted-foreground">{user.createdAt.toLocaleDateString('fr-FR')}</span>
      ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (user, context) => {
        // Display-only without a page context (a picker renders this list).
        if (!context || context.isSelf(user)) return null;
        if (!context.canBan && !context.canDelete) return null;
        return (
          <div className="flex justify-end gap-1">
            {context.canBan &&
              (user.banned ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={context.busy}
                  onClick={() => context.onUnban(user)}
                >
                  <CircleCheck />
                  Réactiver
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={context.busy}
                  onClick={() => context.onBan(user)}
                >
                  <Ban />
                  Suspendre
                </Button>
              ))}
            {context.canDelete && (
              <Button
                variant="destructive"
                size="sm"
                disabled={context.busy}
                onClick={() => context.onDelete(user)}
              >
                <Trash2 />
                Supprimer
              </Button>
            )}
          </div>
        );
      },
    },
  },
});
