/**
 * @cs-bot/shared 类型与工具导出
 *
 * - ErrCode: 错误码枚举
 * - Err / Ok / Result: 轻量 Result 类型
 * - AskReq/AskResp/AskResult/IQAEngine/QAHistory: QA 接口契约
 * - maskPII: PII 脱敏
 * - EnvString/EnvInt/EnvBool/EnvFloat: zod 字段构建器（适配 env 变量字符串）
 */
export { ErrCode } from './errors.js';
export { Err, Ok } from './result.js';
export type { Result } from './result.js';
export type { QAHistory, AskReq, AskResp, AskResult, IQAEngine } from './qa-types.js';
export { maskPII } from './mask.js';
export { EnvString, EnvInt, EnvBool, EnvFloat, preprocessEnv, coerceEnvValue } from './env-schemas.js';
