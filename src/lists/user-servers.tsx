import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { StatusBadge } from '~/components/status-badge';
import { Button } from '~/components/ui/button';
import { defineList, field } from '~/lists/define';
import { SERVER_STATUS_OPTIONS } from '~/lists/servers';

/**
 * /servers — the signed-in user's own servers (Pelican ListServers scoped to
 * the viewer). An admin sees every server, anyone else sees the servers they
 * own PLUS the ones shared with them through a `server_user` grant; that scope
 * is a base condition applied by the server function before the query runs.
 *
 * The columns here are what the table renders AND what the query may
 * filter/sort on — filtering, sorting, search and pagination all run in SQL.
 */

/** Row of the user servers list (what the server function returns). */
export interface UserServerRow {
  id: string;
  name: string;
  status: string;
  nodeName: string;
  createdAt: Date;
}

/** Row actions of the user servers list, supplied by the page. */
export interface UserServersContext {
  deleting: boolean;
  onDelete: (server: UserServerRow) => void;
}

export const userServersList = defineList<UserServerRow, UserServersContext>({
  name: 'servers',
  alias: 's',
  defaultSort: { column: 'createdAt', desc: true },
  searchTargets: ['name'],
  columns: {
    name: {
      header: 'Serveur',
      sort: field('name'),
      cell: (server) => (
        <Link
          to="/servers/$serverId"
          params={{ serverId: server.id }}
          className="font-medium hover:underline"
        >
          {server.name}
        </Link>
      ),
      filter: { control: 'text', target: field('name') },
    },
    node: {
      header: 'Node',
      cell: (server) => <span className="text-muted-foreground">{server.nodeName}</span>,
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
        // A picker renders this list without a page — nothing to act on.
        context === undefined ? null : (
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
      ),
    },
  },
});
