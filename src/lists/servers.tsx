import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { StatusBadge } from '~/components/status-badge';
import { Button } from '~/components/ui/button';
import { defineList, field } from '~/lists/define';

/**
 * /admin/servers — every server of the installation (Pelican admin ListServers).
 *
 * One definition for the whole page: the columns below are what the table
 * renders AND what the query may filter/sort on. `owner` reads through the
 * `user` join, so searching by owner e-mail happens in SQL (the previous version
 * loaded every server plus every user and filtered in memory).
 */

/**
 * DB status values of a server (suspension is a separate flag). Shared with the
 * user-facing `/servers` list so the two stay in sync.
 */
export const SERVER_STATUS_OPTIONS = [
  { value: 'installing', label: 'Installation…' },
  { value: 'install_failed', label: 'Échec installation' },
  { value: 'stopped', label: 'Arrêté' },
  { value: 'starting', label: 'Démarrage…' },
  { value: 'running', label: 'En marche' },
  { value: 'stopping', label: 'Arrêt en cours…' },
  { value: 'crashed', label: 'Planté' },
] as const;

/** Row of the admin servers list (what the server function returns). */
export interface AdminServerRow {
  id: string;
  name: string;
  status: string;
  suspended: boolean;
  nodeName: string;
  recipeName: string;
  ownerName: string | null;
  ownerEmail: string;
  createdAt: Date;
}

/** Row actions of the admin servers list, supplied by the page. */
export interface AdminServersContext {
  canDelete: boolean;
  deleting: boolean;
  onDelete: (server: AdminServerRow) => void;
}

export const adminServersList = defineList<AdminServerRow, AdminServersContext>({
  name: 'admin-servers',
  alias: 's',
  defaultSort: { column: 'createdAt', desc: true },
  searchTargets: ['name', 'u.email'],
  joins: {
    u: { table: 'user', alias: 'u', left: 'id', right: 's.owner_id' },
  },
  columns: {
    name: {
      header: 'Serveur',
      sort: field('name'),
      cell: (server) => (
        <div>
          <Link
            to="/admin/servers/$serverId"
            params={{ serverId: server.id }}
            className="font-medium hover:underline"
          >
            {server.name}
          </Link>
          <p className="text-xs text-muted-foreground">{server.recipeName}</p>
        </div>
      ),
      filter: { control: 'text', target: field('name') },
    },
    owner: {
      header: 'Propriétaire',
      sort: field('u.email'),
      cell: (server) => (
        <div>
          <p className="font-medium">{server.ownerName ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{server.ownerEmail}</p>
        </div>
      ),
      filter: { control: 'text', target: field('u.email') },
    },
    node: {
      header: 'Node',
      cell: (server) => <span className="text-muted-foreground">{server.nodeName}</span>,
      // Options come from the page (the node list is data, not a constant).
      filter: { control: 'choice', target: field('nodeId'), dynamic: true },
    },
    status: {
      header: 'Statut',
      sort: field('status'),
      cell: (server) => <StatusBadge status={server.status} />,
      filter: {
        control: 'choice',
        target: field('status'),
        options: SERVER_STATUS_OPTIONS,
        multiple: true,
      },
    },
    suspended: {
      header: 'Suspendu',
      sort: field('suspended'),
      cell: (server) =>
        server.suspended ? (
          <span className="text-destructive">Oui</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      filter: { control: 'boolean', target: field('suspended') },
    },
    createdAt: {
      header: 'Créé le',
      sort: field('createdAt'),
      cell: (server) => (
        <span className="text-muted-foreground">
          {server.createdAt.toLocaleDateString('fr-FR')}
        </span>
      ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (server, context) =>
        context.canDelete ? (
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              disabled={context.deleting}
              onClick={() => context.onDelete(server)}
            >
              <Trash2 />
              Supprimer
            </Button>
          </div>
        ) : null,
    },
  },
});
