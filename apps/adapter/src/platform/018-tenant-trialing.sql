-- 租户状态补齐 trialing（spec tenant-registry：trialing → active → grace → suspended → terminated）
-- 序号: 018
-- 幂等：DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT
-- 回滚：如需收窄，先确认无 status='trialing' 的行，再按 015 的值集合重建约束。
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS chk_tenant_status;
ALTER TABLE tenant ADD CONSTRAINT chk_tenant_status
    CHECK (status IN ('created', 'trialing', 'provisioning', 'active', 'grace', 'suspended', 'paused', 'offboarding', 'terminated', 'provisioning_failed'));
