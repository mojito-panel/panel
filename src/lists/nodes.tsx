import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { StatusBadge } from '~/components/status-badge';
import { Button } from '~/components/ui/button';
import { defineList, field } from '~/lists/define';

/**
 * /admin/nodes — every machine hosting a Mojito agent (Pelican admin ListNodes).
 *
 * One definition for the whole page: the columns below are what the table
 * renders AND what the query may filter/sort on. Filtering, sorting and
 * pagination run in the database; the previous version loaded every node and
 * rendered them client-side.
 */

/**
 * DB status values a node can carry: `unknown` until its first health ping
 * (`createNodeFn`), then `online`/`offline` written by the health pings
 * (`getHealthNodesFn` / `getAdminOverviewFn`).
 */
const STATUS_OPTIONS = [
  { value: 'online', label: 'En ligne' },
  { value: 'offline', label: 'Hors ligne' },
  { value: 'unknown', label: 'Inconnu' },
] as const;

/** Row of the admin nodes list (what the server function returns). */
export interface AdminNodeRow {
  id: string;
  name: string;
  fqdn: string;
  scheme: string;
  publicPort: number;
  status: string;
  createdAt: Date;
}

/** Row actions of the admin nodes list, supplied by the page. */
export interface AdminNodesContext {
  canDelete: boolean;
  deleting: boolean;
  onDelete: (node: AdminNodeRow) => void;
}

export const adminNodesList = defineList<AdminNodeRow, AdminNodesContext>({
  name: 'admin-nodes',
  alias: 'n',
  defaultSort: { column: 'createdAt', desc: true },
  searchTargets: ['name', 'fqdn'],
  columns: {
    name: {
      header: 'Node',
      sort: field('name'),
      cell: (node) => (
        <Link
          to="/admin/nodes/$nodeId"
          params={{ nodeId: node.id }}
          className="font-medium hover:underline"
        >
          {node.name}
        </Link>
      ),
    },
    address: {
      header: 'Adresse',
      sort: field('fqdn'),
      cell: (node) => (
        <span className="text-muted-foreground">
          {node.scheme}://{node.fqdn}:{node.publicPort}
        </span>
      ),
    },
    status: {
      header: 'Statut',
      sort: field('status'),
      cell: (node) => <StatusBadge status={node.status} />,
      filter: { control: 'choice', target: field('status'), options: STATUS_OPTIONS },
    },
    createdAt: {
      header: 'Créé le',
      sort: field('createdAt'),
      cell: (node) => (
        <span className="text-muted-foreground">
          {node.createdAt.toLocaleDateString('fr-FR')}
        </span>
      ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (node, context) =>
        context.canDelete ? (
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              disabled={context.deleting}
              onClick={() => context.onDelete(node)}
            >
              <Trash2 />
              Supprimer
            </Button>
          </div>
        ) : null,
    },
  },
});
