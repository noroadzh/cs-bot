-- miss_record 按租户隔离（shared / dedicated 数据面）
ALTER TABLE miss_record
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_miss_tenant_created
  ON miss_record (tenant_id, created_at DESC);

COMMENT ON COLUMN miss_record.tenant_id IS '实例 TENANT_ID；空=未绑定私有化';
