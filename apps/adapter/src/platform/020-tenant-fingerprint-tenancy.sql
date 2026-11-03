-- 租户实例指纹 + 租户模式（dedicated | shared）
-- 序号: 020
-- 幂等：ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS tenancy_mode TEXT NOT NULL DEFAULT 'dedicated';
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS chk_tenant_tenancy_mode;
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_tenancy_mode
  CHECK (tenancy_mode IN ('dedicated', 'shared'));

COMMENT ON COLUMN tenant.fingerprint IS '租户实例机器指纹；签发 license 优先用此值';
COMMENT ON COLUMN tenant.tenancy_mode IS 'dedicated=独立 compose；shared=同进程逻辑隔离';
