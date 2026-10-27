import { defineList, field } from '~/lists/define';

/** All pg-boss job states (the DB enum `pgboss.job_state`). */
export const JOB_STATES = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'] as const;

export type JobState = (typeof JOB_STATES)[number];

/** French label + chip color class of every job state. */
export const JOB_STATE_LABELS: Record<JobState, string> = {
  created: 'En attente',
  retry: 'À retester',
  active: 'En cours',
  completed: 'Terminé',
  cancelled: 'Annulé',
  failed: 'Échoué',
};

export const JOB_STATE_CHIP_CLASS: Record<JobState, string> = {
  created: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  retry: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  active: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/15 text-destructive',
};

/** One row of the admin jobs dashboard (a raw `pgboss.job` read). */
export interface AdminJobRow {
  id: string;
  name: string;
  state: JobState;
  retryCount: number;
  retryLimit: number;
  startAfter: string | null;
  startedOn: string | null;
  completedOn: string | null;
  createdOn: string | null;
  output: string | null;
  data: string | null;
}

export const adminJobsList = defineList<AdminJobRow>({
  name: 'admin-jobs',
  alias: 'j',
  defaultSort: { column: 'createdOn', desc: true },
  columns: {
    id: {
      header: 'ID',
      sort: field('id'),
      cell: (job) => <code className="text-xs">{job.id.slice(0, 8)}</code>,
    },
    name: {
      header: 'File',
      sort: field('name'),
      cell: (job) => <code className="text-xs">{job.name}</code>,
      filter: { control: 'text', target: field('name') },
    },
    state: {
      header: 'Statut',
      sort: field('state'),
      cell: (job) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            JOB_STATE_CHIP_CLASS[job.state] ?? 'bg-muted text-muted-foreground'
          }`}
        >
          {JOB_STATE_LABELS[job.state] ?? job.state}
        </span>
      ),
      filter: {
        control: 'choice',
        target: field('state'),
        options: JOB_STATES.map((state) => ({ value: state, label: JOB_STATE_LABELS[state] })),
        multiple: true,
      },
    },
    createdOn: {
      header: 'Créé le',
      sort: field('created_on'),
      cell: (job) => (
        <span className="text-muted-foreground">
          {job.createdOn ? new Date(job.createdOn).toLocaleString('fr-FR') : '—'}
        </span>
      ),
    },
    retryCount: {
      header: 'Tentatives',
      sort: field('retry_count'),
      cell: (job) => (
        <span className="text-muted-foreground">
          {job.retryCount}/{job.retryLimit}
        </span>
      ),
    },
    startAfter: {
      header: 'Lancement prévu',
      sort: field('start_after'),
      cell: (job) => (
        <span className="text-muted-foreground">
          {job.startAfter ? new Date(job.startAfter).toLocaleString('fr-FR') : '—'}
        </span>
      ),
    },
    startedOn: {
      header: 'Démarré le',
      sort: field('started_on'),
      cell: (job) => (
        <span className="text-muted-foreground">
          {job.startedOn ? new Date(job.startedOn).toLocaleString('fr-FR') : '—'}
        </span>
      ),
    },
    completedOn: {
      header: 'Terminé le',
      sort: field('completed_on'),
      cell: (job) => (
        <span className="text-muted-foreground">
          {job.completedOn ? new Date(job.completedOn).toLocaleString('fr-FR') : '—'}
        </span>
      ),
    },
    output: {
      header: 'Sortie',
      cell: (job) =>
        job.output ? (
          <span className="block max-w-xs truncate text-xs text-muted-foreground" title={job.output}>
            {job.output}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  },
});
