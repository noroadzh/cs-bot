/**
 * 容器资源水位采样（概设 M11 / platform-monitoring）
 *
 * - 内存：优先 cgroup v2（memory.max/current），其次 cgroup v1（memory.limit_in_bytes/usage_in_bytes），
 *   不可用时回退宿主 totalmem/freemem。
 * - CPU：loadavg(1min) / 核数 ×100 的近似值（容器 CPU 限额下仍能反映压力趋势）。
 *
 * 任何异常都返回 0，健康检查不能因指标采集失败而 500。
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';

export interface ResourceMetrics {
  cpuPct: number;
  memPct: number;
}

export interface ResourceProbeDeps {
  readFile?: (path: string) => string;
  totalmem?: () => number;
  freemem?: () => number;
  cpus?: () => unknown[];
  loadavg?: () => number[];
}

/** 大于该值的 cgroup 限额视为「未限制」 */
const UNLIMITED_BYTES = 1e15;

function toNumber(raw: string): number | null {
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

export function readResourceMetrics(deps: ResourceProbeDeps = {}): ResourceMetrics {
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  const totalmem = deps.totalmem ?? (() => os.totalmem());
  const freemem = deps.freemem ?? (() => os.freemem());
  const cpus = deps.cpus ?? (() => os.cpus());
  const loadavg = deps.loadavg ?? (() => os.loadavg());

  const hostMemPct = (): number => {
    try {
      const total = totalmem();
      const free = freemem();
      return total > 0 ? ((total - free) / total) * 100 : 0;
    } catch {
      return 0;
    }
  };
  const readNum = (path: string): number | null => {
    try {
      return toNumber(readFile(path));
    } catch {
      return null;
    }
  };

  let memPct = 0;
  let limit = readNum('/sys/fs/cgroup/memory.max');
  let used = readNum('/sys/fs/cgroup/memory.current');
  if (limit === null || used === null) {
    limit = readNum('/sys/fs/cgroup/memory/memory.limit_in_bytes');
    used = readNum('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  }
  memPct =
    limit !== null && used !== null && limit > 0 && limit < UNLIMITED_BYTES
      ? (used / limit) * 100
      : hostMemPct();

  let cpuPct = 0;
  try {
    const cores = Math.max(1, cpus().length);
    const load1 = loadavg()[0] ?? 0;
    cpuPct = (load1 / cores) * 100;
  } catch {
    cpuPct = 0;
  }

  return { cpuPct: clampPct(cpuPct), memPct: clampPct(memPct) };
}
