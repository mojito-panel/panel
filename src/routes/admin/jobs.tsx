import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { RefreshCw } from 'lucide-react';
import { DataTable } from '~/components/data-table/data-table';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { getJobStatsFn, listJobsFn } from '~/server/functions/jobs';
import { adminJobsList, JOB_STATES, JOB_STATE_LABELS } from '~/lists/jobs';
import { mergeQuery, type ListQuery } from '~/lists/define';

/**
 * /admin/jobs — pg-boss jobs dashboard: every queued/running/done job of
 * the panel, with its state, retries and output. Read-only — the data is
 * pg-boss's own `job` table. The summary cards + table refresh every 5 s.
 */
export const Route = createFileRoute('/admin/jobs')({
  validateSearch: (search: Record<string, unknown>): ListQuery => adminJobsList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(adminJobsList.defaultSearch)] },
  component: AdminJobsPage,
});

function AdminJobsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const getJobs = useServerFn(listJobsFn);
  const getJobStats = useServerFn(getJobStatsFn);

  const statsQuery = useQuery({
    queryKey: ['admin-jobs-stats'],
    queryFn: () => getJobStats(),
    refetchInterval: 5000,
  });

  const jobsQuery = useQuery({
    queryKey: ['admin-jobs', search],
    queryFn: () => getJobs({ data: search }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });

  const stats = statsQuery.data ?? {};
  const totalJobs = Object.values(stats).reduce((sum, count) => sum + count, 0);

  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Jobs pg-boss</h1>
          <p className="text-muted-foreground">
            {totalJobs} job{totalJobs === 1 ? '' : 's'} dans la file — rafraîchi toutes les 5 s.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => jobsQuery.refetch()} disabled={jobsQuery.isFetching}>
          <RefreshCw className={jobsQuery.isFetching ? 'animate-spin' : undefined} />
          Rafraîchir
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {JOB_STATES.map((state) => (
          <Card key={state}>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats[state] ?? 0}</div>
              <p className="text-xs text-muted-foreground">{JOB_STATE_LABELS[state]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent>
          <DataTable
            list={adminJobsList}
            rows={jobsQuery.data?.rows ?? []}
            rowCount={jobsQuery.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={jobsQuery.isPending}
            isFetching={jobsQuery.isFetching}
            error={jobsQuery.error}
            emptyMessage="Aucun job dans la file."
          />
        </CardContent>
      </Card>
    </div>
  );
}
