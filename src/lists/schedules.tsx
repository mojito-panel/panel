import { Pencil, Play, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { cronToHuman } from '~/lib/cron';
import { defineList, field } from '~/lists/define';

/**
 * /servers/$serverId/schedules — cron schedules of ONE server (Pelican
 * "Schedules" tab). The list is scoped to a server at the query-builder
 * level (the server id is a route param, not a search param — see
 * `listSchedulesFn`).
 */

/** Row of the schedules list (what the server function returns). */
export interface ServerScheduleRow {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  isActive: boolean;
  isProcessing: boolean;
  onlyWhenOnline: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
}

/** Status chip — Active / Inactive / Processing (Pelican's three states). */
function ScheduleStatusChip({ row }: { row: ServerScheduleRow }) {
  const [label, cls] = row.isProcessing
    ? ['En cours…', 'bg-amber-500/15 text-amber-600 dark:text-amber-400']
    : row.isActive
      ? ['Active', 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400']
      : ['Inactive', 'bg-muted text-muted-foreground'];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

/** Row actions of the schedules list, supplied by the page (mutations + navigation). */
export interface ServerSchedulesContext {
  canUpdate: boolean;
  canDelete: boolean;
  runningNow: boolean;
  deleting: boolean;
  onRunNow: (schedule: ServerScheduleRow) => void;
  onEdit: (schedule: ServerScheduleRow) => void;
  onDelete: (schedule: ServerScheduleRow) => void;
}

export const serverSchedulesList = defineList<ServerScheduleRow, ServerSchedulesContext>({
  name: 'server-schedules',
  alias: 'sc',
  defaultSort: { column: 'nextRunAt', desc: false },
  searchTargets: ['name'],
  columns: {
    name: {
      header: 'Nom',
      sort: field('name'),
      cell: (schedule) => (
        <div>
          <p className="font-medium">{schedule.name}</p>
          <p className="text-xs text-muted-foreground">{cronToHuman(schedule.cron)}</p>
        </div>
      ),
      filter: { control: 'text', target: field('name') },
    },
    cron: {
      header: 'Expression',
      sort: field('cron'),
      cell: (schedule) => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{schedule.cron}</code>
      ),
    },
    nextRunAt: {
      header: 'Prochaine exécution',
      sort: field('nextRunAt'),
      cell: (schedule) => (
        <span className="text-muted-foreground">
          {schedule.isActive
            ? (schedule.nextRunAt?.toLocaleString('fr-FR') ?? '—')
            : '—'}
        </span>
      ),
    },
    lastRunAt: {
      header: 'Dernière exécution',
      sort: field('lastRunAt'),
      cell: (schedule) => (
        <span className="text-muted-foreground">
          {schedule.lastRunAt ? schedule.lastRunAt.toLocaleString('fr-FR') : 'Jamais'}
        </span>
      ),
    },
    isActive: {
      header: 'Statut',
      sort: field('isActive'),
      cell: (schedule) => <ScheduleStatusChip row={schedule} />,
      filter: {
        control: 'boolean',
        target: field('isActive'),
      },
    },
    actions: {
      header: '',
      pinned: true,
      cell: (schedule, context) =>
        // A picker renders this list without a page — nothing to act on.
        context === undefined ? null : (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!context.canUpdate || context.runningNow || !schedule.isActive}
              onClick={() => context.onRunNow(schedule)}
            >
              <Play />
              Exécuter
            </Button>
            {context.canUpdate && (
              <Button size="sm" variant="outline" onClick={() => context.onEdit(schedule)}>
                <Pencil />
                Modifier
              </Button>
            )}
            {context.canDelete && (
              <Button
                size="sm"
                variant="destructive"
                disabled={context.deleting}
                onClick={() => context.onDelete(schedule)}
              >
                <Trash2 />
                Supprimer
              </Button>
            )}
          </div>
        ),
    },
  },
});
