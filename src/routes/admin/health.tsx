import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { RefreshCw } from 'lucide-react';
import { getHealthNodesFn } from '~/server/functions/admin';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { NodeHealthCard } from '~/components/health/node-health-card';

/** /admin/health — node health (real-time graphs via direct WS). */
export const Route = createFileRoute('/admin/health')({ component: AdminHealthPage });

function AdminHealthPage() {
  const getHealthNodes = useServerFn(getHealthNodesFn);

  // List + latency refresh: the LIVE graphs stream over each agent's WS and
  // cost the panel nothing — this poll only re-measures the REST latency.
  const query = useQuery({
    queryKey: ['admin-health'],
    queryFn: () => getHealthNodes(),
    refetchInterval: 30_000,
  });

  const nodes = query.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Santé</h1>
          <p className="text-muted-foreground">
            Métriques des nodes en direct — CPU, RAM, disque, latence.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />
          Rafraîchir
        </Button>
      </div>

      {query.isError && (
        <p className="text-sm text-destructive">Erreur : {query.error.message}</p>
      )}

      {(nodes === undefined || nodes.length === 0) && (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {nodes === undefined
                ? 'Chargement des nodes…'
                : 'Aucun node enregistré — ajoutez-en un depuis la page Nodes.'}
            </p>
          </CardContent>
        </Card>
      )}

      {nodes && nodes.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {nodes.map((node) => (
            <NodeHealthCard key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}
