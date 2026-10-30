-- 租户资源档位：standard（4C8G）/ enhanced（8C16G）
-- 序号: 019
-- 幂等：ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'standard';
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS chk_tenant_plan;
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_plan CHECK (plan IN ('standard', 'enhanced'));
