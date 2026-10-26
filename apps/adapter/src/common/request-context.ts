/**
 * 请求级上下文（AsyncLocalStorage）+ 脱敏工具
 *
 * 让同一次请求处理中的日志自动携带 traceId；并提供日志安全的 id 哈希/截断工具。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export interface RequestContext {
  traceId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** 当前请求的 traceId（非请求上下文返回 undefined） */
export function currentTraceId(): string | undefined {
  return requestContext.getStore()?.traceId;
}

/** 稳定短哈希（用于 chatId/userId 等，避免明文入日志） */
export function hashId(value: string | null | undefined): string {
  if (!value) return '';
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

/** 截断长文本（日志只记前 N 字符 + 原长度） */
export function truncate(value: string | null | undefined, max = 40): string {
  if (!value) return '';
  const s = String(value);
  return s.length <= max ? s : `${s.slice(0, max)}…(len=${s.length})`;
}
