/**
 * 环境变量 schema 字段类型。
 *
 * process.env 的值全是字符串，直接用 z.number()/z.boolean() 校验会失败。
 * 这里统一处理策略：
 * - Env* 常量本身是原生 zod 类型，保留完整链式 API（.min()/.regex()/.url()/.optional()/.default()）；
 * - 字符串 → 目标类型转换由 {@link preprocessEnv} 在 schema 顶层 preprocess 阶段一次完成。
 */
import { z } from 'zod';

// 与原生 zod 类型一致，保证链式 API 可用
export const EnvString = z.string();
export const EnvInt = z.number().int();
export const EnvFloat = z.number();
export const EnvBool = z.boolean();

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

/** 单值转换：字符串 → 强类型。无法识别的原样返回（交给后续 zod string 校验）。 */
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
