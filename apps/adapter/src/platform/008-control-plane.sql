-- M11 控制面扩展（008）
-- 序号: 008
-- 幂等：ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS

-- 租户：证书与密钥引用
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS tls_cert_ref VARCHAR(500);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS secrets_ref VARCHAR(500);

-- 升级批次
CREATE TABLE IF NOT EXISTS tenant_upgrade_batch (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_tag VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

-- 升级前快照
CREATE TABLE IF NOT EXISTS tenant_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES tenant_upgrade_batch(id) ON DELETE SET NULL,
    path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_snapshot_tenant ON tenant_snapshot(tenant_id);

-- 注销申请（双签 / 导出 / T+7 删除）
CREATE TABLE IF NOT EXISTS tenant_offboarding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'requested',
    approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
    export_path TEXT,
    delete_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_offboarding_tenant ON tenant_offboarding(tenant_id);
