/**
 * 注入 ConfigService 单例 + 重置 helper
 *
 * 多数服务构造函数形参声明是 ConfigService，但内部直接读 ConfigService.instance 单例。
 * 这里把单例注入好，保留 services 对 zod 校验的读取路径。
 */
import { ConfigService } from '../../src/config/config.service.js';
import { AppConfigSchema, type AppConfigInput } from '../../src/config/config.schema.js';

export function setConfig(overrides: Partial<AppConfigInput> = {}): AppConfigInput {
  // 用 schema 校验默认值 + overrides，得到完整 input
  const base: Record<string, unknown> = {};
  for (const key of Object.keys(process.env)) {
    if (process.env[key] !== undefined) base[key] = process.env[key];
  }
  const merged = { ...base, ...overrides };
  const parsed = AppConfigSchema.parse(merged);
  // 写入单例（私有静态字段用类型断言）
  (ConfigService as any)._instance = parsed;
  return parsed;
}

export function getConfig(): AppConfigInput {
  return (ConfigService as any)._instance;
}

export function clearConfig(): void {
  (ConfigService as any)._instance = undefined;
}
