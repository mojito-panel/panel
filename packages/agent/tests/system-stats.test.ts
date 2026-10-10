import { describe, it, expect } from 'vitest';
import { SystemStatsCollector, type StatfsLike } from '../src/system/stats';
import { nodeStatsSchema } from '@mojito/contract';

/**
 * Fake CPU ticks — a single "core" whose counters we advance between
 * samples to simulate a known load.
 */
function makeCpus() {
  let idle = 1000;
  let busy = 0;
  return {
    tick(idleDelta: number, busyDelta: number) {
      idle += idleDelta;
      busy += busyDelta;
    },
    cpus: () => [{ idle, user: busy, nice: 0, sys: 0, irq: 0 }],
  };
}

function makeStatfs(totalBytes: number, freeBytes: number, fail = false) {
  const bsize = 512;
  const impl: (path: string) => Promise<StatfsLike> = fail
    ? async () => {
        throw new Error('volume injoignable');
      }
    : async () => ({
        bsize,
        blocks: Math.floor(totalBytes / bsize),
        bfree: Math.floor(freeBytes / bsize),
      });
  return impl;
}

const BASE_DEPS = {
  totalmem: () => 16 * 1024 * 1024 * 1024, // 16 Go
  freemem: () => 8 * 1024 * 1024 * 1024, // 8 Go libres
};

describe('SystemStatsCollector', () => {
  it('renvoie cpuPercent 0 sur le tout premier échantillon (pas de delta)', async () => {
    const cpu = makeCpus();
    const collector = new SystemStatsCollector({
      dataDir: 'C:/data',
      version: '0.1.0-test',
      countRunning: () => 2,
      deps: { cpus: cpu.cpus, ...BASE_DEPS, statfs: makeStatfs(512 * 1024 ** 3, 256 * 1024 ** 3) },
    });

    const stats = await collector.sample();
    expect(stats.cpuPercent).toBe(0);
    expect(stats.memoryUsedMb).toBe(8 * 1024);
    expect(stats.memoryTotalMb).toBe(16 * 1024);
    expect(stats.diskUsedGb).toBe(256);
    expect(stats.diskTotalGb).toBe(512);
    expect(stats.serversRunning).toBe(2);
    expect(stats.version).toBe('0.1.0-test');
    expect(nodeStatsSchema.safeParse(stats).success).toBe(true);
  });

  it('mesure le CPU sur le delta entre deux échantillons', async () => {
    const cpu = makeCpus();
    const collector = new SystemStatsCollector({
      dataDir: 'C:/data',
      version: '0.1.0-test',
      countRunning: () => 0,
      deps: { cpus: cpu.cpus, ...BASE_DEPS, statfs: makeStatfs(512 * 1024 ** 3, 0) },
    });

    await collector.sample(); // initial snapshot

    // 100 ticks écoulés : 90 busy / 10 idle → 90 % d'utilisation
    cpu.tick(10, 90);
    const busy = await collector.sample();
    expect(busy.cpuPercent).toBe(90);

    // Puis 100 ticks dont 100 idle → 0 %
    cpu.tick(100, 0);
    const idle = await collector.sample();
    expect(idle.cpuPercent).toBe(0);
  });

  it('borne le CPU à [0, 100] (compteurs remis à zéro, glitch)', async () => {
    const cpu = makeCpus();
    const collector = new SystemStatsCollector({
      dataDir: 'C:/data',
      version: '0.1.0-test',
      countRunning: () => 0,
      deps: { cpus: cpu.cpus, ...BASE_DEPS, statfs: makeStatfs(512 * 1024 ** 3, 0) },
    });

    await collector.sample();
    cpu.tick(-5000, 100); // idle counters reset → deltas négatifs
    const stats = await collector.sample();
    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(stats.cpuPercent).toBeLessThanOrEqual(100);
  });

  it('renvoie un disque null quand statfs échoue', async () => {
    const cpu = makeCpus();
    const collector = new SystemStatsCollector({
      dataDir: 'C:/network-drive',
      version: '0.1.0-test',
      countRunning: () => 0,
      deps: { cpus: cpu.cpus, ...BASE_DEPS, statfs: makeStatfs(0, 0, true) },
    });

    const stats = await collector.sample();
    expect(stats.diskUsedGb).toBeNull();
    expect(stats.diskTotalGb).toBeNull();
    expect(nodeStatsSchema.safeParse(stats).success).toBe(true);
  });
});
