/**
 * 启动配置 zod schema
 * 所有凭证即使 mock 模式也必须存在
 */
import { z } from 'zod';
import { EnvString, EnvInt, EnvBool, EnvFloat, preprocessEnv } from '@cs-bot/shared';

export const AppConfigSchema = z.preprocess(preprocessEnv, z.object({
  // 企微
  WECHAT_CORP_ID: EnvString.regex(/^[a-zA-Z0-9_\-]{6,30}$/, 'WECHAT_CORP_ID format'),
  WECHAT_AGENT_ID: EnvInt(),
  WECHAT_AGENT_SECRET: EnvString.min(8),
  WECHAT_TOKEN: EnvString.min(3),
  WECHAT_ENCODING_AES_KEY: EnvString.length(43),

  // FastGPT
  FASTGPT_BASE_URL: EnvString.url(),
  FASTGPT_API_KEY: EnvString.min(8),
  FASTGPT_DATASET_IDS: EnvString.default(''),

  // LLM
  LLM_PRIMARY_BASE_URL: EnvString.url(),
  LLM_PRIMARY_API_KEY: EnvString.min(8),
  LLM_FALLBACK_BASE_URL: EnvString.url(),
  LLM_FALLBACK_API_KEY: EnvString.min(8),
  LLM_TIMEOUT_MS: EnvInt(15000),

  // Admin
  ADMIN_USER: EnvString.default('admin'),
  ADMIN_PASSWORD: EnvString.min(6),
  ALLOWED_ADMIN_IPS: EnvString.default('127.0.0.1/32'),

  // Mode
  USE_MOCK_LLM: EnvBool(true),
  USE_MOCK_LICENSE: EnvBool(true),

  // 阈值
  CONFIDENCE_THRESHOLD: EnvFloat(0.75),
  CONTEXT_ROUNDS: EnvInt(5),
  CONTEXT_TTL_SEC: EnvInt(600),
  MISS_RECORD_RETENTION_DAYS: EnvInt(90),
  SLOW_REPLY_TEXT: EnvString.default('系统繁忙，请稍后再试或联系人工客服'),

  // 拒绝话术
  REFUSAL_TEXT: EnvString.default('暂时没有合适答案，已记录到工单。紧急问题请 @ 客服。'),

  // Redis
  REDIS_HOST: EnvString.default('127.0.0.1'),
  REDIS_PORT: EnvInt(6379),
  REDIS_PASSWORD: EnvString.optional().default(''),
  REDIS_DB: EnvInt(0),

  // Postgres
  DATABASE_URL: EnvString.default('postgresql://cs:cs@127.0.0.1:5432/csbot'),

  // License
  LICENSE_FILE: EnvString.default('license/license.lic'),
  // 运维告警 webhook（企微群机器人）；空串 = 关闭告警。到期提醒 / 新群被拒 / 指纹变化都走它
  OPS_WEBHOOK_URL: EnvString.optional().default(''),

  // 限流
  RATE_GROUP_PER_MIN: EnvInt(20),
  RATE_USER_PER_MIN: EnvInt(5),

  // 长答案分段
  MAX_SEGMENT_BYTES: EnvInt(2048),
  SEGMENT_SAFE_BYTES: EnvInt(2000),
  SEGMENT_GAP_MS: EnvInt(300),

  // Server
  PORT: EnvInt(3000),
  HOST: EnvString.default('0.0.0.0'),

  // Asset / Mock
  MOCK_QA_FILE: EnvString.default('config/mock-qa.json'),
  KEYWORDS_FILE: EnvString.default('config/keywords.yml'),
  SENSITIVE_WORDS_FILE: EnvString.default('config/sensitive-words.txt'),

  // Media
  MAX_ASSET_BYTES: EnvInt(20971520), // 20MB
  // 未配置（''）表示 mock/关闭；配置了则必须是合法 URL / 足长 key
  QWEN_VL_BASE_URL: EnvString.url().optional().or(z.literal('')),
  QWEN_VL_API_KEY: EnvString.min(8).optional().or(z.literal('')),

  // Usage
  USAGE_REPORT_ENABLED: EnvBool(false),
  USAGE_WEBHOOK_URL: EnvString.optional().default(''),
  USAGE_REPORT_INTERVAL_MS: EnvInt(86400000), // 24h
  USAGE_PERIOD: z.enum(['daily', 'weekly', 'monthly']).default('daily'),

  // Bot user
  WECHAT_BOT_USER_ID: EnvString.optional().default(''),
}));

export type AppConfigInput = z.infer<typeof AppConfigSchema>;
