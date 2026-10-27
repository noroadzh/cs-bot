/**
 * 提问归一化：剥离 @机器人 / 触发词前缀，压缩空白。
 * 触发词表来自 keywords.yml（与 TriggerService 同源），按文件 mtime 缓存。
 */
import { readFileSync, statSync } from 'node:fs';
import yaml from 'js-yaml';

let cache: { path: string; mtimeMs: number; prefixes: string[] } | null = null;

export function loadTriggerPrefixes(file: string): string[] {
  if (!file) return [];
  try {
    const st = statSync(file);
    if (!cache || cache.path !== file || cache.mtimeMs !== st.mtimeMs) {
      const doc = yaml.load(readFileSync(file, 'utf8')) as { keywords?: unknown } | null;
      const words = Array.isArray(doc?.keywords)
        ? doc!.keywords.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
        : [];
      cache = { path: file, mtimeMs: st.mtimeMs, prefixes: words };
    }
    return cache.prefixes;
  } catch {
    return [];
  }
}

/** 供测试使用的缓存清理 */
export function resetPrefixCache(): void {
  cache = null;
}

export function normalizeQuestion(raw: string, prefixes: string[] = []): string {
  let q = (raw ?? '').trim();
  // 连续去掉开头的 @xx（企微 Content 可能带 @机器人 文本）
  while (/^@\S+\s*/.test(q)) q = q.replace(/^@\S+\s*/, '');
  for (const p of [...prefixes].sort((a, b) => b.length - a.length)) {
    if (q.startsWith(p)) {
      q = q.slice(p.length).trim();
      break;
    }
  }
  return q.replace(/\s+/g, ' ').trim();
}

/** 空问题 / 纯标点 / 超过 500 字 → 需要引导话术（不调模型） */
export function isUnusableQuestion(q: string): boolean {
  if (!q) return true;
  if (q.length > 500) return true;
  return /^[\p{P}\p{S}\s]+$/u.test(q);
}
