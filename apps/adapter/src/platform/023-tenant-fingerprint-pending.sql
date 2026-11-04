-- 开通后指纹回采重签：待处理标记
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS fingerprint_pending BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenant.fingerprint_pending IS '实例指纹回采或 license 重签待运营重试';
