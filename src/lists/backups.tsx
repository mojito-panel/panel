import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { InProgressBadge } from '~/components/status-badge';
import { Button } from '~/components/ui/button';
import { formatSize } from '~/components/files/format-size';
import { defineList, field } from '~/lists/define';

/**
 * /servers/$serverId/backups — archives of ONE server (Pelican "Backups" tab).
 *
 * The list is scoped to a server at the query-builder level (the server id is a
 * route param, not a search param — see `listBackupsFn`). The columns below are
 * what the table renders AND what the query may filter/sort on; the in-flight
 * status sync stays in the server function.
 */

/** Lifecycle of a backup row (`restoring` while a restore runs). */
export type BackupStatus = 'pending' | 'running' | 'restoring' | 'completed' | 'failed';

/** Row of the backups list (what the server function returns). */
export interface ServerBackupRow {
  id: string;
  name: string;
  status: BackupStatus;
  sizeBytes: number;
  checksum: string | null;
  error: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

const STATUS_LABELS: Record<BackupStatus, string> = {
  pending: 'En attente',
  running: 'En cours…',
  restoring: 'Restauration…',
  completed: 'Terminée',
  failed: 'Échouée',
};

/** Options of the `status` filter — the real DB statuses of a backup row. */
const STATUS_OPTIONS = (Object.keys(STATUS_LABELS) as BackupStatus[]).map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

/**
 * Small status chip — in-progress jobs (pending/running/restoring) share
 * the breathing amber chip of the status badges; terminal states keep their
 * own tint (backups have their own lifecycle, not StatusBadge).
 */
function BackupStatusChip({ status }: { status: BackupStatus }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex h-6 items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        {STATUS_LABELS.completed}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex h-6 items-center rounded-full border border-red-500/25 bg-red-500/10 px-2.5 text-xs font-medium text-red-700 dark:text-red-300">
        {STATUS_LABELS.failed}
      </span>
    );
  }
  return <InProgressBadge label={STATUS_LABELS[status]} />;
}

/** Row actions of the backups list, supplied by the page (mutations + toasts). */
export interface ServerBackupsContext {
  canRestore: boolean;
  canDelete: boolean;
  downloading: boolean;
  restoring: boolean;
  deleting: boolean;
  onDownload: (backup: ServerBackupRow) => void;
  onRestore: (backup: ServerBackupRow, truncate: boolean) => void;
  onDelete: (backup: ServerBackupRow) => void;
}

export const serverBackupsList = defineList<ServerBackupRow, ServerBackupsContext>({
  name: 'server-backups',
  alias: 'b',
  defaultSort: { column: 'createdAt', desc: true },
  searchTargets: ['name'],
  columns: {
    name: {
      header: 'Nom',
      sort: field('name'),
      cell: (backup) => (
        <div>
          <p className="font-medium">{backup.name}</p>
          {backup.error && <p className="text-xs text-destructive">{backup.error}</p>}
        </div>
      ),
      filter: { control: 'text', target: field('name') },
    },
    status: {
      header: 'Statut',
      sort: field('status'),
      cell: (backup) => <BackupStatusChip status={backup.status} />,
      filter: {
        control: 'choice',
        target: field('status'),
        options: STATUS_OPTIONS,
        multiple: true,
      },
    },
    sizeBytes: {
      header: 'Taille',
      sort: field('sizeBytes'),
      cell: (backup) => (
        <span className="text-muted-foreground">{formatSize(backup.sizeBytes)}</span>
      ),
    },
    createdAt: {
      header: 'Créée le',
      sort: field('createdAt'),
      cell: (backup) => (
        <span className="text-muted-foreground">
          {backup.createdAt.toLocaleString('fr-FR')}
        </span>
      ),
    },
    completedAt: {
      header: 'Terminée le',
      sort: field('completedAt'),
      cell: (backup) => (
        <span className="text-muted-foreground">
          {backup.completedAt ? backup.completedAt.toLocaleString('fr-FR') : '—'}
        </span>
      ),
    },
    actions: {
      header: '',
      pinned: true,
      cell: (backup, context) =>
        // A picker renders this list without a page — nothing to act on.
        context === undefined ? null : (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={backup.status !== 'completed' || context.downloading}
            onClick={() => context.onDownload(backup)}
          >
            <Download />
            Télécharger
          </Button>
          {context.canRestore && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={backup.status !== 'completed' || context.restoring}
                onClick={() => context.onRestore(backup, false)}
              >
                <RotateCcw />
                Restaurer
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={backup.status !== 'completed' || context.restoring}
                onClick={() => context.onRestore(backup, true)}
              >
                <RotateCcw />
                Remplacer
              </Button>
            </>
          )}
          {context.canDelete && (
            <Button
              size="sm"
              variant="destructive"
              disabled={context.deleting}
              onClick={() => context.onDelete(backup)}
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
