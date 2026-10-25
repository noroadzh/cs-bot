-- M11: 租户与平台审计相关表
-- 依赖: 无 (纯新增)
-- 序号: 007

-- 租户表
CREATE TABLE IF NOT EXISTS tenant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'created',
    -- status: created, provisioning, active, grace, suspended, paused, terminated, provisioning_failed
    host VARCHAR(255), --  provisioned 后填充，格式 host:port
    port INTEGER,
    database_url TEXT, -- 租户独立 DB 连接串（ provisioned 后填充）
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expired_at TIMESTAMPTZ, -- 过期时间
    last_provision_log TEXT, -- 最近一次编排操作的 stdout/stderr
    deleted_at TIMESTAMPTZ
);

-- 租户配额表
CREATE TABLE IF NOT EXISTS tenant_quota (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES tenant(id) ON DELETE CASCADE,
    max_chats INTEGER NOT NULL DEFAULT 0,           -- 累计会话数上限
    max_storage_mb INTEGER NOT NULL DEFAULT 0,      -- 存储 MB 上限
    max_api_calls INTEGER NOT NULL DEFAULT 0,       -- API 调用次数上限
    max_users INTEGER NOT NULL DEFAULT 0,           -- 用户数上限
    max_llm_tokens_per_month INTEGER NOT NULL DEFAULT 0, -- LLM token 月度上限（0=不限）
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 兼容旧表：补 LLM token 月度上限列
ALTER TABLE tenant_quota ADD COLUMN IF NOT EXISTS max_llm_tokens_per_month INTEGER NOT NULL DEFAULT 0;

-- 租户每日用量表
CREATE TABLE IF NOT EXISTS tenant_usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    day DATE NOT NULL, -- 日期（不含时间）
    chat_count INTEGER NOT NULL DEFAULT 0,
    api_call_count INTEGER NOT NULL DEFAULT 0,
    storage_bytes BIGINT NOT NULL DEFAULT 0,
    user_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, day)
);

-- 平台审计日志表 (链式)
CREATE TABLE IF NOT EXISTS platform_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGSERIAL, -- 插入顺序（审计链按此串接；UUID 随机不可当顺序）
    tenant_id UUID REFERENCES tenant(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    actor VARCHAR(255) NOT NULL, -- 操作者标识（IP、service account 等）
    payload JSONB NOT NULL, -- 操作详情
    prev_hash VARCHAR(64) NOT NULL DEFAULT '', -- 上一条记录的 hash，空串表示链首
    hash VARCHAR(64) NOT NULL, -- 本条记录的 hash = sha256(prev_hash + action + actor + payload + created_at)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 兼容已建表：补自增序号列（旧表无 seq 时填充），并建唯一索引
ALTER TABLE platform_audit_log ADD COLUMN IF NOT EXISTS seq BIGSERIAL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_audit_log_seq ON platform_audit_log(seq);

-- 索引: tenant
CREATE INDEX IF NOT EXISTS idx_tenant_status ON tenant(status);
CREATE INDEX IF NOT EXISTS idx_tenant_expired_at ON tenant(expired_at);
CREATE INDEX IF NOT EXISTS idx_tenant_created_at ON tenant(created_at DESC);

-- 索引: tenant_usage_daily
CREATE INDEX IF NOT EXISTS idx_tenant_usage_daily_tenant_day ON tenant_usage_daily(tenant_id, day DESC);

-- 索引: platform_audit_log
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_tenant_id ON platform_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_action ON platform_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_created_at ON platform_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_hash ON platform_audit_log(hash);

-- 状态 CHECK 约束（幂等：重复执行自动跳过）
DO $$ BEGIN
    ALTER TABLE tenant ADD CONSTRAINT chk_tenant_status
        CHECK (status IN ('created', 'provisioning', 'active', 'grace', 'suspended', 'paused', 'terminated', 'provisioning_failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;