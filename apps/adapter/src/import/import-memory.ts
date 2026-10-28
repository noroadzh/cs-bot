/** 导入内存守卫：增量 >200MB 或 RSS >80% 配置限额 */
export function shouldPauseImport(rss: number, baseline: number, limitMb: number): boolean {
  const incrementalMb = (rss - baseline) / 1024 / 1024;
  return incrementalMb > 200 || rss > limitMb * 1024 * 1024 * 0.8;
}
