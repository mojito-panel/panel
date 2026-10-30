import { Area, AreaChart, CartesianGrid, Customized, XAxis, YAxis } from 'recharts';

import { useFlowSamples } from '~/components/health/use-flow-samples';
import { useNodeStatsStream } from '~/components/health/use-node-stats-stream';
import { LiveIndicator } from '~/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '~/components/ui/chart';
import { Skeleton } from '~/components/ui/skeleton';
import { HEALTH_STATS_INTERVAL_MS, type NodeStats } from '~/contract';
import { isHttpsScheme } from '~/validators/node';

/**
 * One node card on /admin/health: identity + latency from the panel's REST
 * ping, live CPU/RAM graphs from the direct agent WS, disk as a stat (a
 * volume's usage barely moves — a chart adds noise, not information).
 */

export interface NodeHealthDto {
  id: string;
  name: string;
  fqdn: string;
  scheme: string;
  publicPort: number;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: Date | string | null;
  latencyMs: number | null;
  snapshot: NodeStats | null;
}

const CPU_CONFIG = {
  cpu: { label: 'CPU', color: 'var(--color-orange-400)' },
} as const;

const RAM_CONFIG = {
  mem: { label: 'RAM', color: 'var(--color-red-500)' },
} as const;

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} j ${hours % 24} h`;
}

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} Go` : `${Math.round(mb)} Mo`;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Small labeled value, uniform across the card's stat rows. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

export function NodeHealthCard({ node }: { node: NodeHealthDto }) {
  const online = node.status === 'online';
  const stream = useNodeStatsStream(node.id);

  // Live WS frame first; the REST snapshot covers the first seconds
  const stats = stream.stats ?? node.snapshot;
  const connection = online ? stream.connection : 'disconnected';

  // Charts read the FLOWING version of the buffer: useFlowSamples glides the
  // series toward each new frame (rAF, linear, one interval per morph) — a
  // continuous stream, with recharts animation OFF (it restarts interrupted
  // morphs from the old shape = the yoyo). See use-flow-samples.ts.
  const flowSamples = useFlowSamples(stream.samples, HEALTH_STATS_INTERVAL_MS, [
    'cpuPercent',
    'memoryUsedMb',
  ]);
  // mem is charted in Go (1 decimal) so the native tooltip value reads like
  // the CPU one — a custom formatter would REPLACE the whole tooltip row
  // (indicator + label + value), making the two charts hover differently.
  const chartData = flowSamples.map((s) => ({
    time: formatTime(s.timestamp),
    cpu: s.cpuPercent,
    mem: Math.round((s.memoryUsedMb / 1024) * 10) / 10,
  }));

  const diskPercent =
    stats?.diskTotalGb && stats.diskTotalGb > 0 && stats.diskUsedGb !== null
      ? Math.min(100, (stats.diskUsedGb / stats.diskTotalGb) * 100)
      : null;

  // Per-node gradient ids — several cards render on the same page
  const cpuGradientId = `cpu-gradient-${node.id}`;
  const memGradientId = `mem-gradient-${node.id}`;

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{node.name}</CardTitle>
            {online && <LiveIndicator live={connection === 'live'} />}
          </div>
          <span className="text-muted-foreground font-mono text-xs">
            {node.fqdn}
            {node.publicPort !== (isHttpsScheme(node.scheme) ? 443 : 80) && `:${node.publicPort}`}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {!online ? (
          <p className="text-muted-foreground text-sm">
            Agent injoignable — vérifiez qu’il tourne et que le token est valide. Dernier contact :{' '}
            {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString('fr-FR') : 'jamais'}.
          </p>
        ) : (
          <div className="space-y-4">
            {/* ─── Stats row ─── */}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Stat
                label="Latence"
                value={node.latencyMs !== null ? `${node.latencyMs} ms` : '—'}
              />
              <Stat label="Version" value={stats?.version ?? '—'} />
              <Stat label="Uptime" value={stats ? formatUptime(stats.uptimeSeconds) : '—'} />
              <Stat label="Serveurs actifs" value={String(stats?.serversRunning ?? '—')} />
              <Stat
                label="Disque"
                value={
                  stats?.diskTotalGb && stats.diskUsedGb !== null
                    ? `${stats.diskUsedGb} / ${stats.diskTotalGb} Go`
                    : '—'
                }
              />
            </div>

            {/* Disk gauge (volume usage — not worth a time series) */}
            {diskPercent !== null && (
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-500 ease-out"
                  style={{ width: `${diskPercent}%` }}
                />
              </div>
            )}

            {/* ─── Live charts (direct agent WS) ─── */}
            {chartData.length === 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground mb-1 text-xs">
                    CPU {stats ? `${stats.cpuPercent}%` : ''}
                  </p>
                  <ChartContainer config={CPU_CONFIG} className="h-32 w-full">
                    <AreaChart data={chartData} margin={{ top: 4, bottom: 0, left: 0, right: 4 }}>
                      <Customized
                        component={
                          <defs>
                            <linearGradient id={cpuGradientId} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--color-cpu)" stopOpacity={0.35} />
                              <stop offset="100%" stopColor="var(--color-cpu)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                        }
                      />
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="time"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={6}
                        minTickGap={28}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 50, 100]}
                        tickFormatter={(v) => `${v}%`}
                        tickLine={false}
                        axisLine={false}
                        width={36}
                      />
                      <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                      <Area
                        dataKey="cpu"
                        type="monotone"
                        stroke="var(--color-cpu)"
                        fill={`url(#${cpuGradientId})`}
                        strokeWidth={2}
                        // The flow is driven by useFlowSamples — recharts must
                        // NOT animate (restart artifact = the yoyo)
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>

                <div>
                  <p className="text-muted-foreground mb-1 text-xs">
                    RAM{' '}
                    {stats
                      ? `${formatMb(stats.memoryUsedMb)} / ${formatMb(stats.memoryTotalMb)}`
                      : ''}
                  </p>
                  <ChartContainer config={RAM_CONFIG} className="h-32 w-full">
                    <AreaChart data={chartData} margin={{ top: 4, bottom: 0, left: 0, right: 4 }}>
                      <Customized
                        component={
                          <defs>
                            <linearGradient id={memGradientId} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--color-mem)" stopOpacity={0.35} />
                              <stop offset="100%" stopColor="var(--color-mem)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                        }
                      />
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="time"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={6}
                        minTickGap={28}
                      />
                      <YAxis
                        domain={[0, (max: number) => max]}
                        tickFormatter={(v) => `${Math.round(v)}G`}
                        tickLine={false}
                        axisLine={false}
                        width={36}
                      />
                      <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                      <Area
                        dataKey="mem"
                        type="monotone"
                        stroke="var(--color-mem)"
                        fill={`url(#${memGradientId})`}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
