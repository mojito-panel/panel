import { SERVER_STATS_INTERVAL_MS, type ServerStats, type ServerStatsSample } from '~/contract';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '~/components/ui/chart';
import { useFlowSamples } from '~/components/health/use-flow-samples';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Customized,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Live resource cards of a server (CPU / RAM / Réseau), fed by the console
 * WS: the agent replays its stats ring on connect (the last minute of
 * the process tree's life), then pushes one full frame per second — the
 * page replaces its state wholesale, this component just renders it.
 *
 * The three cards line up in a row UNDER the console — the console keeps
 * its full width, the page just grows taller.
 */

const CPU_CONFIG = {
  cpu: { label: 'CPU', color: 'var(--color-orange-400)' },
} as const;

const RAM_CONFIG = {
  ram: { label: 'RAM', color: 'var(--color-red-500)' },
} as const;

const NET_CONFIG = {
  rx: { label: '↓ Réception', color: 'var(--color-blue-500)' },
  tx: { label: '↑ Envoi', color: 'var(--color-emerald-500)' },
} as const;

/** Numeric series the flow animation glides between two frames. */
const FLOW_KEYS = ['cpuPercent', 'memoryMb', 'rxBytesPerSec', 'txBytesPerSec'] as const;

const EMPTY_SAMPLES: ServerStatsSample[] = [];

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} Go` : `${Math.round(mb)} Mo`;
}

function formatCpuPercent(percent: number): string {
  return `${Math.round(percent)} %`;
}

/** RAM axis tick — MB under a Go, Go above (the axis reads like the value). */
function formatMbTick(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb / 1024 < 10 ? 1 : 0)}G` : `${Math.round(mb)}M`;
}

/**
 * Bits per second with fr-FR units — the Réseau card's live values.
 * The agent sends bytes/s; the display converts (×8) to Kbps and up.
 */
function formatBps(bytesPerSec: number): string {
  const bps = bytesPerSec * 8;
  if (bps < 1000) return `${Math.round(bps)} bps`;
  if (bps < 1000 ** 2) return `${(bps / 1000).toFixed(1)} Kbps`;
  if (bps < 1000 ** 3) return `${(bps / 1000 ** 2).toFixed(1)} Mbps`;
  return `${(bps / 1000 ** 3).toFixed(1)} Gbps`;
}

/** Compact axis tick, bits per second (no unit suffix — the card header carries it). */
function formatBpsTick(bytesPerSec: number): string {
  const bps = bytesPerSec * 8;
  if (bps < 1000) return `${Math.round(bps)}`;
  if (bps < 1000 ** 2) return `${Math.round(bps / 1000)}K`;
  if (bps < 1000 ** 3) return `${(bps / 1000 ** 2).toFixed(1)}M`;
  return `${(bps / 1000 ** 3).toFixed(1)}G`;
}

/** 1 / 2 / 5 × 10^n — the Réseau card's dynamic axis ceiling. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

interface StatChartProps {
  /** recharts chart data: `time` + the charted value under `dataKey`. */
  data: Array<Record<string, number | string>>;
  /** Chart config (label + color) — also drives the tooltip. */
  config: ChartConfig;
  dataKey: string;
  /** SVG id of the area's gradient fill (defined inline per chart). */
  gradientId: string;
  /** Y axis domain and tick formatter — fixed for CPU/RAM, dynamic for Réseau. */
  domain: [number, number];
  tickFormatter: (value: number) => string;
  /** Tooltip value formatting (adds the unit the raw number lacks). */
  tooltipFormatter: (value: number) => string;
}

/** One compact area chart (no visible X axis — the card stays tight). */
function StatChart({ data, config, dataKey, gradientId, domain, tickFormatter, tooltipFormatter }: StatChartProps) {
  return (
    <ChartContainer config={config} className="h-28 w-full">
      <AreaChart data={data} margin={{ top: 4, bottom: 0, left: 0, right: 4 }}>
        <Customized
          component={
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.35} />
                <stop offset="100%" stopColor={`var(--color-${dataKey})`} stopOpacity={0} />
              </linearGradient>
            </defs>
          }
        />
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        {/* Hidden but present: the tooltip's label resolves from the
            X axis dataKey — without it, hovering reads a bare index. */}
        <XAxis dataKey="time" hide />
        <YAxis
          domain={domain}
          ticks={domain}
          tickFormatter={tickFormatter}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              indicator="line"
              formatter={(value) => tooltipFormatter(Number(value))}
            />
          }
        />
        <Area
          dataKey={dataKey}
          type="monotone"
          stroke={`var(--color-${dataKey})`}
          fill={`url(#${gradientId})`}
          strokeWidth={2}
          // The flow is driven by useFlowSamples — recharts must NOT
          // animate (restart artifact = the yoyo)
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/** Placeholder while the ring is empty — `hint` explains WHY (the
 *  page knows whether the server runs, the agent answered at all). */
function EmptyChart({ hint }: { hint: string }) {
  return (
    <div className="flex h-28 items-center justify-center px-2 text-center text-xs text-muted-foreground">
      {hint}
    </div>
  );
}

export function ServerStatsCards({ stats, hint }: { stats: ServerStats | null; hint: string }) {
  const samples = stats?.samples ?? EMPTY_SAMPLES;

  // Same flow animation as the node health charts: the series glide
  // linearly toward each new frame over one sampling interval.
  const flowSamples = useFlowSamples(samples, SERVER_STATS_INTERVAL_MS, FLOW_KEYS);

  const chartData = flowSamples.map((sample) => ({
    time: formatTime(sample.at),
    cpu: sample.cpuPercent,
    ram: sample.memoryMb,
    rx: sample.rxBytesPerSec,
    tx: sample.txBytesPerSec,
  }));

  const latest = samples.length > 0 ? samples[samples.length - 1] : null;

  // CPU / RAM: the axis is FIXED to the server's allocation (a 3-core
  // server reads 0 → 300 %, the RAM 0 → its limit) — a server with no
  // allocation scales to the host size (the frame carries the max).
  const cpuMax = stats?.cpuMaxPercent ?? 100;
  const memoryMax = stats?.memoryMaxMb ?? 1024;

  // Réseau: DYNAMIC scale — 25 % headroom over the window's peak, snapped
  // to a 1/2/5×10^n ceiling, floored at 1 Kio/s so an idle line does not
  // jitter the axis.
  const peak = samples.reduce(
    (max, sample) => Math.max(max, sample.rxBytesPerSec, sample.txBytesPerSec),
    0,
  );
  const netMax = Math.max(1024, niceCeil(peak * 1.25));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">CPU</CardTitle>
          <CardDescription>
            {latest && stats ? `${formatCpuPercent(latest.cpuPercent)} / ${formatCpuPercent(cpuMax)}` : '—'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <EmptyChart hint={hint} />
          ) : (
            <StatChart
              data={chartData}
              config={CPU_CONFIG}
              dataKey="cpu"
              gradientId="server-cpu-gradient"
              domain={[0, cpuMax]}
              tickFormatter={formatCpuPercent}
              tooltipFormatter={formatCpuPercent}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">RAM</CardTitle>
          <CardDescription>
            {latest && stats ? `${formatMb(latest.memoryMb)} / ${formatMb(memoryMax)}` : '—'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <EmptyChart hint={hint} />
          ) : (
            <StatChart
              data={chartData}
              config={RAM_CONFIG}
              dataKey="ram"
              gradientId="server-ram-gradient"
              domain={[0, memoryMax]}
              tickFormatter={formatMbTick}
              tooltipFormatter={formatMb}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Réseau</CardTitle>
          {/* The live values with their arrows — ↓ download, ↑ upload. */}
          <CardDescription>
            {latest ? (
              <span className="tabular-nums">
                ↓ {formatBps(latest.rxBytesPerSec)} · ↑ {formatBps(latest.txBytesPerSec)}
              </span>
            ) : (
              '—'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <EmptyChart hint={hint} />
          ) : (
            <ChartContainer config={NET_CONFIG} className="h-28 w-full">
              <AreaChart data={chartData} margin={{ top: 4, bottom: 0, left: 0, right: 4 }}>
                <Customized
                  component={
                    <defs>
                      <linearGradient id="server-rx-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-rx)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-rx)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="server-tx-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-tx)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-tx)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                  }
                />
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="time" hide />
                <YAxis
                  domain={[0, netMax]}
                  ticks={[0, netMax / 2, netMax]}
                  tickFormatter={formatBpsTick}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <ChartTooltip
                  content={<ChartTooltipContent indicator="line" formatter={(value) => formatBps(Number(value))} />}
                />
                <Area
                  dataKey="rx"
                  type="monotone"
                  stroke="var(--color-rx)"
                  fill="url(#server-rx-gradient)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  dataKey="tx"
                  type="monotone"
                  stroke="var(--color-tx)"
                  fill="url(#server-tx-gradient)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
