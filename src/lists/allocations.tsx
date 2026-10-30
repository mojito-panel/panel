import { Star, Trash2 } from 'lucide-react';

import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { defineList, field } from '~/lists/define';

/**
 * Allocation lists — the IP:port rows of a node's pool and of one server.
 *
 * Two definitions live here because the SAME table serves three surfaces: the
 * user Network page (/servers/$serverId/network) and the admin record
 * (/admin/servers/$serverId) both render the server's OWN allocations
 * (`serverAllocationsList`), while the admin node page
 * (/admin/nodes/$nodeId) renders the WHOLE pool of a node, free and assigned
 * (`nodeAllocationsList`). Every surface scopes the query by a route param
 * (nodeId / serverId) on the query builder BEFORE `runListQuery` runs.
 */

/** Row of a server's allocations list (Network page + admin record). */
export interface ServerAllocationRow {
  id: string;
  ip: string;
  port: number;
  alias: string | null;
  primary: boolean;
}

/** Row actions of a server's allocations list, supplied by the page. */
export interface ServerAllocationsContext {
  /** The viewer may set the primary / release (per-server `server.network.update`
   *  on the Network page, `panel.servers.update` on the admin record). */
  canEdit: boolean;
  /** A row action is in flight (disables the buttons). */
  busy: boolean;
  onSetPrimary: (allocation: ServerAllocationRow) => void;
  onRevoke: (allocation: ServerAllocationRow) => void;
}

/** Chip shown on the primary allocation (source of SERVER_PORT / SERVER_IP). */
function PrimaryChip() {
  return (
    <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
      Principale
    </span>
  );
}

export const serverAllocationsList = defineList<ServerAllocationRow, ServerAllocationsContext>({
  name: 'server-allocations',
  alias: 'a',
  defaultSort: { column: 'port', desc: false },
  searchTargets: ['ip', 'alias'],
  columns: {
    address: {
      header: 'Adresse',
      className: 'font-mono',
      sort: field('ip'),
      cell: (allocation) => allocation.ip,
    },
    port: {
      header: 'Port',
      sort: field('port'),
      cell: (allocation) => allocation.port,
    },
    alias: {
      header: 'Alias',
      sort: field('alias'),
      cell: (allocation) => allocation.alias ?? '—',
    },
    primary: {
      header: 'Principale',
      filter: { control: 'boolean', target: field('primary') },
      cell: (allocation, context) =>
        allocation.primary ? (
          <PrimaryChip />
        ) : context?.canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={context.busy}
            onClick={() => context.onSetPrimary(allocation)}
          >
            <Star />
            Définir principale
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (allocation, context) =>
        context?.canEdit ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              // The primary carries SERVER_PORT / SERVER_IP — it must be moved
              // before it can be released (same rule as the server function).
              disabled={allocation.primary || context.busy}
              title={
                allocation.primary
                  ? 'Définis une autre allocation principale avant de retirer celle-ci'
                  : undefined
              }
              onClick={() => context.onRevoke(allocation)}
            >
              <Trash2 />
              Retirer
            </Button>
          </div>
        ) : null,
    },
  },
});

/** Row of a node's allocations pool (admin node page). */
export interface NodeAllocationRow {
  id: string;
  ip: string;
  port: number;
  alias: string | null;
  /** Assigned server — null = free allocation in the node pool. */
  serverId: string | null;
  serverName: string | null;
  primary: boolean;
}

/** Row actions of the node pool, supplied by the page. */
export interface NodeAllocationsContext {
  /** Servers installed on the node — candidates of the assign picker. */
  servers: readonly { id: string; name: string }[];
  /** A row action is in flight (disables the buttons). */
  busy: boolean;
  /** Bulk selection of FREE allocations (bulk delete) — see `select` column. */
  selection: NodeAllocationsSelection;
  onAssign: (allocation: NodeAllocationRow, serverId: string) => void;
  onDelete: (allocation: NodeAllocationRow) => void;
  onRevoke: (allocation: NodeAllocationRow) => void;
}

/**
 * Bulk selection state of the node pool, supplied by the page — mirrors the
 * files browser selection. Only FREE allocations are selectable: an assigned
 * one must be revoked before it can be deleted, so it carries no checkbox.
 */
export interface NodeAllocationsSelection {
  /** Selected free allocation ids (may span pages — ids, not row indexes). */
  selected: readonly string[];
  /** Whether every free row of the current page is selected (header checkbox). */
  allSelected: boolean;
  /** Whether at least one free row of the current page is selected (indeterminate). */
  someSelected: boolean;
  onToggle: (allocationId: string) => void;
  onToggleAll: () => void;
}

export const nodeAllocationsList = defineList<NodeAllocationRow, NodeAllocationsContext>({
  name: 'node-allocations',
  alias: 'a',
  defaultSort: { column: 'port', desc: false },
  searchTargets: ['ip', 'alias'],
  columns: {
    select: {
      header: '',
      pinned: true,
      headerCell: (context) => {
        const selection = context?.selection;
        if (!selection) return null;
        return (
          <Checkbox
            checked={selection.allSelected}
            indeterminate={!selection.allSelected && selection.someSelected}
            onCheckedChange={() => selection.onToggleAll()}
            aria-label="Tout sélectionner"
          />
        );
      },
      cell: (allocation, context) => {
        const selection = context?.selection;
        // Only FREE rows are selectable — an assigned allocation must be
        // revoked first (same rule as its per-row actions).
        if (!selection || allocation.serverId !== null) return null;
        return (
          <Checkbox
            checked={selection.selected.includes(allocation.id)}
            onCheckedChange={() => selection.onToggle(allocation.id)}
            aria-label={`Sélectionner ${allocation.ip}:${allocation.port}`}
          />
        );
      },
    },
    address: {
      header: 'Adresse',
      className: 'font-mono',
      sort: field('ip'),
      cell: (allocation) => allocation.ip,
    },
    port: {
      header: 'Port',
      sort: field('port'),
      cell: (allocation) => allocation.port,
    },
    alias: {
      header: 'Alias',
      sort: field('alias'),
      cell: (allocation) => allocation.alias ?? '—',
    },
    assigned: {
      header: 'Serveur',
      // `'true'` = the IS NULL rows = the free allocations of the pool.
      filter: {
        control: 'nullable',
        target: field('serverId'),
        labels: ['Libre', 'Assignée'],
      },
      cell: (allocation) =>
        allocation.serverId === null ? (
          <span className="text-muted-foreground">Libre</span>
        ) : (
          <div className="flex items-center gap-2">
            <span>{allocation.serverName}</span>
            {allocation.primary && <PrimaryChip />}
          </div>
        ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (allocation, context) =>
        // A picker renders this list without a page — nothing to act on.
        !context ? null : allocation.serverId === null ? (
          <div className="flex items-center justify-end gap-2">
            {context.servers.length > 0 && (
              <Select
                value=""
                onValueChange={(serverId) => {
                  if (serverId !== null) context.onAssign(allocation, serverId);
                }}
              >
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue placeholder="— Affecter à —" />
                </SelectTrigger>
                <SelectContent>
                  {context.servers.map((server) => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={context.busy}
              onClick={() => context.onDelete(allocation)}
            >
              <Trash2 />
              Supprimer
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={context.busy}
              onClick={() => context.onRevoke(allocation)}
            >
              Révoquer
            </Button>
          </div>
        ),
    },
  },
});
