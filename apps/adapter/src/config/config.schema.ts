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
  LLM_RETRY_DELAY_MS: EnvInt(1000),
  LLM_PRIMARY_MODEL: EnvString.default('deepseek-chat'),

  // Admin
  ADMIN_USER: EnvString.default('admin'),
  ADMIN_PASSWORD: EnvString.min(6),
  ALLOWED_ADMIN_IPS: EnvString.default('127.0.0.1/32'),
  TRUSTED_PROXY_CIDRS: EnvString.default('127.0.0.1/32,::1/128'),

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
  REFUSAL_TEXT: EnvString.default('抱歉，这个问题超出了我的知识范围，已为您记录，稍后由人工补充解答。'),
  QUESTION_GUIDANCE_TEXT: EnvString.default('请用一句完整的话描述您想咨询的问题～'),
  /** 素材外发失败时的降级提示（概设 M8：任一素材失败补发一次） */
  ASSET_FAIL_TEXT: EnvString.default('有关联附件没能发送成功，需要的话请回复人工客服～'),

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
  RATE_HINT_TEXT: EnvString.default('提问太频繁，请稍后再试'),
  ALLOWED_CHAT_IDS: EnvString.default(''),
  /** 群聊场景要求每条触发消息必须带 ChatId（缺失则丢弃并告警，不回退私聊） */
  REQUIRE_GROUP_CHAT_ID: EnvBool(true),
  /** 单聊/应用消息被动回复等待（毫秒）。超时则回空包并主动发送 */
  PASSIVE_REPLY_MS: EnvInt(3500),

  // 群聊回复队列（按 chat+user 串行）
  REPLY_QUEUE_ENABLED: EnvBool(true),
  REPLY_QUEUE_MAX: EnvInt(20),
  REPLY_QUEUE_WAIT_TIMEOUT_MS: EnvInt(60_000),
  REPLY_QUEUE_HINT_TEXT: EnvString.default('问题较多，请稍后再试～'),

  // 出站并发上限
  LLM_CONCURRENCY: EnvInt(4),
  /** 双通道失败告警：窗口内失败次数阈值 / 窗口 / 冷却 */
  /** 运维事件告警冷却（验签失败等），默认 30 分钟 */
  OPS_ALERT_COOLDOWN_MS: EnvInt(1_800_000),
  LLM_ALERT_THRESHOLD: EnvInt(3),
  LLM_ALERT_WINDOW_MS: EnvInt(300_000),
  LLM_ALERT_COOLDOWN_MS: EnvInt(1_800_000),
  WECOM_CONCURRENCY: EnvInt(8),
  WECOM_SEND_MAX_ATTEMPTS: EnvInt(3),
  WECOM_SEND_BACKOFF_MS: EnvInt(300),
  WECOM_SEND_BACKOFF_MAX_MS: EnvInt(5000),
  VL_CONCURRENCY: EnvInt(2),

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
  MAX_IMAGE_BYTES: EnvInt(10 * 1024 * 1024), // 10MB (M8 入站图片)
  // 未配置（''）表示 mock/关闭；配置了则必须是合法 URL / 足长 key
  QWEN_VL_BASE_URL: EnvString.url().optional().or(z.literal('')),
  QWEN_VL_API_KEY: EnvString.min(8).optional().or(z.literal('')),
  QWEN_VL_MODEL: EnvString.default('qwen-vl-plus'),

  // Usage
  USAGE_REPORT_ENABLED: EnvBool(false),
  USAGE_WEBHOOK_URL: EnvString.optional().default(''),
  USAGE_REPORT_INTERVAL_MS: EnvInt(86400000), // 24h
  USAGE_PERIOD: z.enum(['daily', 'weekly', 'monthly']).default('daily'),

  // Bot user
  WECHAT_BOT_USER_ID: EnvString.optional().default(''),
  WECHAT_BOT_NAME: EnvString.optional().default(''),

  // Swagger docs (production: disable via SWAGGER_ENABLED=false)
  SWAGGER_ENABLED: EnvBool(true),

  // Import (M10)
  IMPORT_MAX_FILE_BYTES: EnvInt(200 * 1024 * 1024), // 200MB
  IMPORT_MAX_FILE_BYTES_URL: EnvInt(200 * 1024 * 1024), // 200MB (URL fetch)
  IMPORT_MAX_MESSAGES: EnvInt(50000),
  IMPORT_MEMORY_LIMIT_MB: EnvInt(512),
  MOCK_REDACTION: EnvBool(false),
  IMPORT_RULES_FILE: EnvString.default('config/import-rules.yml'),
  IMPORT_NAMES_FILE: EnvString.default('config/import-names.txt'),
  IMPORT_BLACKLIST_FILE: EnvString.default('config/import-blacklist.txt'),
  IMPORT_PAIR_GAP_MINUTES: EnvInt(30),
  IMPORT_MIN_ANSWER_CHARS: EnvInt(6),

  // Platform (M11) — PLATFORM_ENABLED=false 时 platform 路由整体关闭
  PLATFORM_ENABLED: EnvBool(false),
  PLATFORM_COMPOSE_DIR: EnvString.default('data/tenants'),
  PLATFORM_PROVISION_TIMEOUT_MS: EnvInt(120000), // 120s
  PLATFORM_MASTER_KEY: EnvString.optional().default(''),
  PLATFORM_TLS_PROVIDER: EnvString.default('fake'),
  PLATFORM_CERT_DIR: EnvString.default('data/tenants/certs'),
  PLATFORM_BACKUP_DIR: EnvString.default('backup/tenants'),
  PLATFORM_CERT_CMD: EnvString.optional().default(''),
  LICENSE_ISSUER: EnvString.default('noop'),
  LICENSE_ISSUER_BIN: EnvString.default('tools/license-issuer/license-issuer'),
  LICENSE_ISSUER_KEY: EnvString.optional().default(''),
  /** 设置后由该命令对 payload JSON 签名（stdin → stdout base64），不读取 PEM */
  LICENSE_SIGN_CMD: EnvString.optional().default(''),
  LICENSE_ISSUER_OUT_DIR: EnvString.default('data/licenses'),
  PLATFORM_LICENSE_FINGERPRINT: EnvString.optional().default(''),
  PLATFORM_HEALTH_URL_TEMPLATE: EnvString.default('http://{host}/healthz'),
  PLATFORM_TENANT_CONTROL_PLANE_URL: EnvString.optional().default('http://host.docker.internal:3100'),
  PLATFORM_SHARED_NETWORK: EnvString.default('csbot-control'),
  PLATFORM_INSTANCE_SCHEME: EnvString.default('https'),
  PLATFORM_VERIFY_TLS: EnvBool(true),
  PLATFORM_INSTANCE_TIMEOUT_MS: EnvInt(8000),
  TENANT_ADMIN_ALLOW_CIDRS: EnvString.default(''),
  /** 资源水位告警：阈值(%) 与连续次数 */
  PLATFORM_RESOURCE_ALERT_PCT: EnvInt(90),
  PLATFORM_RESOURCE_ALERT_STREAK: EnvInt(3),
  PLATFORM_MONITOR_INTERVAL_MS: EnvInt(60000),
  PLATFORM_RESTART_FAILURE_THRESHOLD: EnvInt(2),
  PLATFORM_RESTART_MAX_PER_HOUR: EnvInt(3),
  PLATFORM_UPGRADE_SCRIPT: EnvString.default('scripts/tenant-upgrade.sh'),
  EMAIL_WEBHOOK_URL: EnvString.optional().default(''),
  SMTP_HOST: EnvString.optional().default(''),
  SMTP_PORT: EnvInt(587),
  SMTP_FROM: EnvString.optional().default(''),
  SMTP_USER: EnvString.optional().default(''),
  SMTP_PASSWORD: EnvString.optional().default(''),
  PLATFORM_AUDIT_ARCHIVE_DIR: EnvString.default('backup/audit'),
  PLATFORM_UPGRADE_WINDOW: EnvString.default('02:00-04:00'),
  PLATFORM_UPGRADE_NOTICE_DAYS: EnvInt(3),
  PLATFORM_CANARY_OBSERVE_MS: EnvInt(86_400_000),
  PLATFORM_UPGRADE_CANARY_ID: EnvString.optional().default(''),

  // 模型通道（增项 D）：所有模式都走 FastGPT RAG
  // cloud  = FastGPT（云端模型渠道），低分/失败可切直连云 fallback
  // hybrid = FastGPT（本地渠道优先），FastGPT 故障时允许切直连云 fallback
  // local  = FastGPT（本地渠道），禁止任何云回退
  MODEL_MODE: z.enum(['cloud', 'hybrid', 'local']).default('cloud'),
  // FastGPT 本地模型渠道地址（部署参考；实际调用由 FastGPT 完成）
  LOCAL_LLM_BASE_URL: EnvString.optional().default(''),
  LOCAL_LLM_API_KEY: EnvString.optional().default(''),
  LOCAL_LLM_MODEL: EnvString.optional().default(''),
  LOCAL_LLM_TIMEOUT_MS: EnvInt(25000),
  LOCAL_EMBEDDING_URL: EnvString.optional().default(''),

  // 当前实例所属租户（形态 B：每租户一实例）。空 = 数据面不做 tenant 配额/状态准入。
  TENANT_ID: EnvString.optional().default(''),
  /** 控制面 → 数据面内部同步 Bearer token */
  TENANT_SYNC_TOKEN: EnvString.optional().default(''),
  CONTROL_PLANE_URL: EnvString.optional().default(''),
  CONTROL_PLANE_TOKEN: EnvString.optional().default(''),

  // 日志（可观测性，无 SSH 排查）
  LOG_LEVEL: EnvString.default('info'),
  LOG_FILE: EnvString.optional().default(''),
  LOG_HTTP: EnvBool(true),
  SLOW_LOG_MS: EnvInt(2000),
  LOG_PRETTY: EnvBool(false),
}).superRefine((cfg, ctx) => {
  const needsLocal = cfg.MODEL_MODE === 'local' || cfg.MODEL_MODE === 'hybrid';
  if (needsLocal && !cfg.LOCAL_LLM_BASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LOCAL_LLM_BASE_URL'],
      message: 'LOCAL_LLM_BASE_URL is required when MODEL_MODE is local or hybrid',
    });
  }
  if (needsLocal && cfg.LOCAL_LLM_BASE_URL && !/^https?:\/\//.test(cfg.LOCAL_LLM_BASE_URL)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LOCAL_LLM_BASE_URL'],
      message: 'LOCAL_LLM_BASE_URL must be an http(s) URL',
    });
  }
}));

export type AppConfigInput = z.infer<typeof AppConfigSchema>;
