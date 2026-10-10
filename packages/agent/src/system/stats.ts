import { statfs as realStatfs } from 'node:fs/promises';
import { cpus as realCpus, freemem as realFreemem, totalmem as realTotalmem } from 'node:os';
import type { NodeStats } from '@mojito/contract';

/**
 * System metrics collector. Wings reads Docker/cgroup stats — we ARE the
 * process host (native Windows, no Docker), so we read the OS directly:
 * - CPU %: delta of the aggregated os.cpus() idle vs total ticks between two
 *   samples — the push cadence (2s) is the measurement window;
 * - RAM: os.totalmem() - os.freemem() (host-wide, no per-process bridging V1);
 * - disk: fs.statfs of the agent's dataDir (works on Windows, Node 24);
 * - uptime/version: the agent process itself.
 * Every sample is ephemeral — nothing is persisted, the panel treats health
 * as "the last frame it received" (Pelican semantics).
 */

export interface StatfsLike {
  bsize: number;
  blocks: number;
  bfree: number;
}

/** Injectable OS/filesystem seams (tests inject fakes — no real CPU needed). */
export interface SystemStatsDeps {
  cpus?: () => { idle: number; user: number; nice: number; sys: number; irq: number }[];
  totalmem?: () => number;
  freemem?: () => number;
  statfs?: (path: string) => Promise<StatfsLike>;
}

export interface SystemStatsOptions {
  /** Disk usage is measured on the volume hosting the servers. */
  dataDir: string;
  version: string;
  /** Number of running game servers (ServerManager.isRunning per stored server). */
  countRunning: () => number | Promise<number>;
  deps?: SystemStatsDeps;
}

const GIB = 1024 * 1024 * 1024;

/** Aggregated CPU ticks (idle vs total) across all cores. */
type CpuTimes = { idle: number; user: number; nice: number; sys: number; irq: number };

function cpuTicks(infos: CpuTimes[]): {
  idle: number;
  total: number;
} {
  let idle = 0;
  let total = 0;
  for (const info of infos) {
    idle += info.idle;
    total += info.user + info.nice + info.sys + info.idle + info.irq;
  }
  return { idle, total };
}

export class SystemStatsCollector {
  readonly #options: SystemStatsOptions;
  readonly #cpus: () => CpuTimes[];
  readonly #totalmem: () => number;
  readonly #freemem: () => number;
  readonly #statfs: (path: string) => Promise<StatfsLike>;
  #lastTicks: { idle: number; total: number } | null = null;

  constructor(options: SystemStatsOptions) {
    this.#options = options;
    // os.cpus() nests the counters in `times` — flatten to the shape we consume
    this.#cpus = options.deps?.cpus ?? (() => realCpus().map((c) => c.times));
    this.#totalmem = options.deps?.totalmem ?? realTotalmem;
    this.#freemem = options.deps?.freemem ?? realFreemem;
    this.#statfs =
      options.deps?.statfs ??
      (async (path) => {
        const s = await realStatfs(path);
        return { bsize: s.bsize, blocks: s.blocks, bfree: s.bfree };
      });
  }

  /**
   * CPU % since the previous sample (0 on the very first one — there is no
   * delta to measure yet). Clamped to [0, 100], one decimal.
   */
  #cpuPercent(): number {
    const ticks = cpuTicks(this.#cpus());
    const previous = this.#lastTicks;
    this.#lastTicks = ticks;
    if (!previous) return 0;

    const totalDelta = ticks.total - previous.total;
    const idleDelta = ticks.idle - previous.idle;
    if (totalDelta <= 0 || idleDelta < 0) return 0;

    const percent = (1 - idleDelta / totalDelta) * 100;
    return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
  }

  /** Disk usage of the dataDir volume — null,null when statfs fails. */
  async #disk(): Promise<{ diskUsedGb: number | null; diskTotalGb: number | null }> {
    try {
      const s = await this.#statfs(this.#options.dataDir);
      const totalGb = (s.blocks * s.bsize) / GIB;
      const usedGb = ((s.blocks - s.bfree) * s.bsize) / GIB;
      if (!Number.isFinite(totalGb) || totalGb <= 0) {
        return { diskUsedGb: null, diskTotalGb: null };
      }
      return {
        diskUsedGb: Math.max(0, Math.round(usedGb * 10) / 10),
        diskTotalGb: Math.round(totalGb * 10) / 10,
      };
    } catch {
      // Unmounted/unreachable volume — the health page shows the disk as unknown
      return { diskUsedGb: null, diskTotalGb: null };
    }
  }

  /** One full stats frame (the health WS pushes one every interval). */
  async sample(): Promise<NodeStats> {
    const cpuPercent = this.#cpuPercent();
    const memoryTotalMb = this.#totalmem() / (1024 * 1024);
    const memoryUsedMb = Math.max(0, memoryTotalMb - this.#freemem() / (1024 * 1024));
    const { diskUsedGb, diskTotalGb } = await this.#disk();

    return {
      timestamp: new Date().toISOString(),
      cpuPercent,
      memoryUsedMb: Math.round(memoryUsedMb * 10) / 10,
      memoryTotalMb: Math.round(memoryTotalMb * 10) / 10,
      diskUsedGb,
      diskTotalGb,
      uptimeSeconds: Math.floor(process.uptime()),
      version: this.#options.version,
      serversRunning: await this.#countRunningSafe(),
    };
  }

  async #countRunningSafe(): Promise<number> {
    try {
      return await this.#options.countRunning();
    } catch {
      return 0;
    }
  }
}
