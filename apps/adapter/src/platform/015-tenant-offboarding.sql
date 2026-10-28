-- M11 注销流程：确认令牌 / 计划删除 / 删除确认单
-- 序号: 015
-- 幂等：IF NOT EXISTS / DROP CONSTRAINT IF EXISTS

-- 租户状态加入 offboarding
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS chk_tenant_status;
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_status
    CHECK (status IN ('created', 'provisioning', 'active', 'grace', 'suspended', 'paused', 'offboarding', 'terminated', 'provisioning_failed'));

-- 注销记录补齐令牌与确认字段
ALTER TABLE tenant_offboarding
    ADD COLUMN IF NOT EXISTS confirm_token_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS destroyed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmation JSONB;

-- 每租户仅一条注销记录（重复 export 覆盖旧记录）；先清理历史重复行
DELETE FROM tenant_offboarding a
 USING tenant_offboarding b
 WHERE a.tenant_id = b.tenant_id
   AND a.created_at < b.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_offboarding_tenant ON tenant_offboarding(tenant_id);

-- 删除确认单（合规留痕，随租户删除保留）
CREATE TABLE IF NOT EXISTS tenant_destroy_confirmation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    package_path TEXT,
    approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_tenant_destroy_confirmation_tenant
    ON tenant_destroy_confirmation(tenant_id);
