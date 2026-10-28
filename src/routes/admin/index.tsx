import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Network, Puzzle, RefreshCw, Server, Users } from 'lucide-react';
import { getAdminOverviewFn, getAdminOverviewHealthFn } from '~/server/functions/admin';
import { adminNodesList } from '~/lists/nodes';
import { StatusBadge, isLiveData } from '~/components/status-badge';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

/** /admin — admin overview page (Pelican admin overview). */
export const Route = createFileRoute('/admin/')({
  component: AdminOverviewPage,
});

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Server;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-2xl font-bold leading-none">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {label}
            {hint && <span className="ml-1 text-xs">· {hint}</span>}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminOverviewPage() {
  const getOverview = useServerFn(getAdminOverviewFn);
  const getOverviewHealth = useServerFn(getAdminOverviewHealthFn);
  // DB overview (fast) — the dashboard renders from this alone.
  const query = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => getOverview(),
    refetchInterval: 30_000,
  });

  // LIVE agent health — polled at a regular interval; the node badges and
  // agent versions show skeletons until the first answer, never block.
  const healthQuery = useQuery({
    queryKey: ['admin-overview-health'],
    queryFn: () => getOverviewHealth(),
    refetchInterval: 5_000,
  });

  const data = query.data;
  // Live health indexed by node id — null while the poll is in flight.
  const healthById = new Map(healthQuery.data?.map((n) => [n.id, n]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vue d’ensemble</h1>
          <p className="text-muted-foreground">
            Tableau de bord de l’infrastructure — compteur en temps quasi réel.
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

      {/* ─── Counters ─── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Server}
          label="Serveurs"
          value={data?.counts.servers ?? '…'}
          hint={
            data
              ? `${data.counts.running} en cours${data.counts.installing ? ` · ${data.counts.installing} install.` : ''}`
              : undefined
          }
        />
        <StatCard icon={Network} label="Nodes" value={data?.counts.nodes ?? '…'} />
        <StatCard icon={Users} label="Utilisateurs" value={data?.counts.users ?? '…'} />
        <StatCard icon={Puzzle} label="Recettes" value={data?.counts.recipes ?? '…'} />
      </div>

      {/* ─── Nodes health (DB row + live agent poll) ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Nodes</CardTitle>
          <CardDescription>
            Santé des agents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {(data?.nodes ?? []).map((node) => {
              const health = healthById.get(node.id);
              return (
                <div key={node.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{node.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {node.fqdn}:{node.publicPort}
                      {health?.lastSeenAt &&
                        ` · vu ${new Date(health.lastSeenAt).toLocaleString('fr-FR')}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {node.serverCount} serveur{node.serverCount > 1 ? 's' : ''}
                    </span>
                    {healthQuery.isPending ? (
                      <Skeleton className="h-6 w-24 rounded-full" />
                    ) : (
                      // Sonar rings while the ping is fresh (< 20 s) — the
                      // fn measures every node (online OR offline); a node
                      // missing from the answer falls back to its DB status.
                      <StatusBadge
                        status={health?.status ?? node.status}
                        live={health != null && isLiveData(healthQuery)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {data?.nodes.length === 0 && (
              <p className="text-muted-foreground">
                Aucun node.{' '}
                <Link
                  to="/admin/nodes"
                  search={adminNodesList.defaultSearch}
                  className="underline"
                >
                  En ajouter un
                </Link>
                .
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Recent servers ─── */}
      <Card>
        <CardHeader>
          <CardTitle>Derniers serveurs</CardTitle>
          <CardDescription>Les 5 serveurs les plus récemment créés.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {(data?.recentServers ?? []).map((server) => (
              <div key={server.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <Link
                    to="/admin/servers/$serverId"
                    params={{ serverId: server.id }}
                    className="truncate font-medium hover:underline"
                  >
                    {server.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">
                    {server.recipeName} · {server.nodeName} · {server.ownerEmail}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-sm text-muted-foreground sm:inline">
                    {new Date(server.createdAt).toLocaleDateString('fr-FR')}
                  </span>
                  <StatusBadge status={server.status} />
                </div>
              </div>
            ))}
            {data?.recentServers.length === 0 && (
              <p className="text-muted-foreground">Aucun serveur installé pour le moment.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
