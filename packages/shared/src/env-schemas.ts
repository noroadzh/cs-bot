/**
 * 环境变量 schema 字段类型。
 *
 * process.env 的值全是字符串，直接用 z.number()/z.boolean() 校验会失败。
 * 这里提供工厂函数，返回带 coerce（字符串→目标类型）能力的 zod schema。
 * - EnvString: 纯字符串，不过滤（部分字段有额外 regex 约束）
 * - EnvInt(n?): 接受整数字符串，返回整数；若 n !== undefined 则为默认值
 * - EnvFloat(f?): 接受浮点数字符串，返回浮点数；若 f !== undefined 则为默认值
 * - EnvBool(b?): 接受 true/false/1/0 等字符串，返回布尔；若 b !== undefined 则为默认值
 */
import { z } from 'zod';

export const EnvString = z.string();

export function EnvInt(def?: number) {
  return def !== undefined
    ? z.coerce.number().int().default(def)
    : z.coerce.number().int();
}

export function EnvFloat(def?: number) {
  return def !== undefined
    ? z.coerce.number().default(def)
    : z.coerce.number();
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

export function EnvBool(def?: boolean) {
  const coerce = z.preprocess(
    (v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (TRUE_VALUES.has(s)) return true;
        if (FALSE_VALUES.has(s)) return false;
      }
      return v;
    },
    z.boolean(),
  );
  return def !== undefined ? coerce.default(def) : coerce;
}

/** 单值转换：字符串 → 强类型（保留给手动 coerce 调用） */
export function coerceEnvValue(raw: unknown): unknown {
  if (raw === undefined || raw === null) return raw;
  if (typeof raw !== 'string') return raw;
  const s = raw.trim();
  if (s === '') return raw;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  const lower = s.toLowerCase();
  if (TRUE_VALUES.has(lower)) return true;
  if (FALSE_VALUES.has(lower)) return false;
  return raw;
}

/** 顶层 preprocess 包装：把 Record<string,string> 形态的 env 转为强类型 Record。 */
export function preprocessEnv(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = coerceEnvValue(v);
  }
  return out;
}
