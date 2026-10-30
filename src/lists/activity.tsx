import { defineList, field } from '~/lists/define';

/**
 * /servers/$serverId/activity — journal d'activité (audit trail).
 *
 * One row per audited action (power, backups, sub-users, settings…). Rows are
 * written by `logActivity` (~/server/activity) and denormalize the actor and
 * server names, so an entry keeps describing the action after the user or
 * server it mentions is deleted.
 */

/** Row of the activity list (what the server function returns). */
export interface ActivityRow {
  id: string;
  event: string;
  description: string | null;
  ip: string | null;
  actorName: string | null;
  actorEmail: string | null;
  serverId: string | null;
  serverName: string | null;
  /** Pretty-printed JSON of the event context (serializable across the
   * server-function boundary — parse on demand in a cell). */
  properties: string | null;
  createdAt: Date;
}

export const activityList = defineList<ActivityRow>({
  name: 'activity',
  alias: 'a',
  defaultSort: { column: 'createdAt', desc: true },
  searchTargets: ['event', 'description', 'ip', 'actorName', 'actorEmail'],
  columns: {
    createdAt: {
      header: 'Date',
      sort: field('createdAt'),
      cell: (row) => (
        <span className="text-muted-foreground">{row.createdAt.toLocaleString('fr-FR')}</span>
      ),
    },
    event: {
      header: 'Événement',
      sort: field('event'),
      filter: { control: 'text', target: field('event') },
      cell: (row) => <code className="text-xs">{row.event}</code>,
    },
    description: {
      header: 'Description',
      cell: (row) => row.description ?? '—',
    },
    actorName: {
      header: 'Acteur',
      cell: (row) => row.actorName ?? 'Système',
    },
    ip: {
      header: 'IP',
      cell: (row) => row.ip ?? '—',
    },
  },
});
