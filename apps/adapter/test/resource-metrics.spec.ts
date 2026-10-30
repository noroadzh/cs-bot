/**
 * 资源水位采样：cgroup v2 / v1 / 回退 totalmem / 异常兜底
 */
import { describe, it, expect } from '@jest/globals';
import { readResourceMetrics } from '../src/common/resource-metrics.js';

const files = (map: Record<string, string>) => (p: string) => {
  if (p in map) return map[p];
  throw new Error(`ENOENT ${p}`);
};

describe('readResourceMetrics', () => {
  it('uses cgroup v2 memory.max/current', () => {
    const m = readResourceMetrics({
      readFile: files({
        '/sys/fs/cgroup/memory.max': '1000000000\n',
        '/sys/fs/cgroup/memory.current': '400000000\n',
      }),
      cpus: () => new Array(4).fill({}),
      loadavg: () => [2, 1, 1],
    });
    expect(m.memPct).toBe(40);
    expect(m.cpuPct).toBe(50);
  });

  it('falls back to cgroup v1 paths', () => {
    const m = readResourceMetrics({
      readFile: files({
        '/sys/fs/cgroup/memory/memory.limit_in_bytes': '500000000',
        '/sys/fs/cgroup/memory/memory.usage_in_bytes': '250000000',
      }),
      cpus: () => new Array(1).fill({}),
      loadavg: () => [0, 0, 0],
    });
    expect(m.memPct).toBe(50);
    expect(m.cpuPct).toBe(0);
  });

  it('treats cgroup "max" as unlimited and uses host memory', () => {
    const m = readResourceMetrics({
      readFile: files({
        '/sys/fs/cgroup/memory.max': 'max',
        '/sys/fs/cgroup/memory.current': '100',
      }),
      totalmem: () => 1000,
      freemem: () => 250,
      cpus: () => new Array(2).fill({}),
      loadavg: () => [1, 1, 1],
    });
    expect(m.memPct).toBe(75);
    expect(m.cpuPct).toBe(50);
  });

  it('never throws and clamps to 0..100', () => {
    const m = readResourceMetrics({
      readFile: () => { throw new Error('boom'); },
      totalmem: () => 0,
      freemem: () => 0,
      cpus: () => { throw new Error('no cpus'); },
      loadavg: () => { throw new Error('no load'); },
    });
    expect(m).toEqual({ cpuPct: 0, memPct: 0 });

    const high = readResourceMetrics({
      readFile: files({
        '/sys/fs/cgroup/memory.max': '100',
        '/sys/fs/cgroup/memory.current': '1000',
      }),
      cpus: () => new Array(1).fill({}),
      loadavg: () => [99, 0, 0],
    });
    expect(high.memPct).toBe(100);
    expect(high.cpuPct).toBe(100);
  });
});
