import { createFileRoute, stripSearchParams, useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DataTable } from '~/components/data-table/data-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { mergeQuery, type ListQuery } from '~/lists/define';
import { activityList } from '~/lists/activity';
import { listAllActivityFn } from '~/server/functions/activity';

export const Route = createFileRoute('/admin/activity')({
  // Same schema as the server function: the route validates the URL, the
  // function validates the payload — one definition, no drift.
  validateSearch: (search: Record<string, unknown>): ListQuery =>
    activityList.querySchema.parse(search),
  search: { middlewares: [stripSearchParams(activityList.defaultSearch)] },
  component: AdminActivityPage,
});

function AdminActivityPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const listAllActivity = useServerFn(listAllActivityFn);

  const query = useQuery({
    queryKey: ['admin-activity', search],
    queryFn: () => listAllActivity({ data: search }),
    placeholderData: keepPreviousData,
  });

  // Search updates write the WHOLE validated query back to the URL.
  const onSearchChange = (patch: Partial<ListQuery>) =>
    navigate({ search: mergeQuery(search, patch), replace: true });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Activité</CardTitle>
          <CardDescription>
            Journal d'audit du panel : toutes les actions enregistrées, tous serveurs
            confondus.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            list={activityList}
            rows={query.data?.rows ?? []}
            rowCount={query.data?.rowCount ?? 0}
            search={search}
            onSearchChange={onSearchChange}
            isPending={query.isPending}
            isFetching={query.isFetching}
            error={query.error}
            emptyMessage="Aucune activité enregistrée."
          />
        </CardContent>
      </Card>
    </div>
  );
}
