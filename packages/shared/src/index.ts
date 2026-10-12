/**
 * @cs-bot/shared
 * 公共类型与工具：
 * - Result/Ok/Err: 兼容 JS 的 Result 类型
 * - ErrCode: 全局错误码
 * - AskReq/AskResp/AskResult/IQAEngine/QAHistory: QA 接口契约
 * - envString/preprocessEnv: 环境变量 Zod 预处理
 * - maskPII: 脱敏
 * - logRedact: 日志脱敏
 */
export { Ok, Err } from './result.js';
export type { Result } from './result.js';
export { ErrCode } from './errors.js';
export {
  EnvString,
  EnvInt,
  EnvFloat,
  EnvBool,
  preprocessEnv,
  coerceEnvValue,
} from './env-schemas.js';
export { maskPII, logRedact } from './redact.js';
export { IQA_ENGINE, IQAEngine, QAHistory, AskReq, AskResp, AskResult } from './qa-types.js';
