-- asset 按租户隔离
ALTER TABLE asset
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_asset_tenant_created
  ON asset (tenant_id, created_at DESC);

COMMENT ON COLUMN asset.tenant_id IS '实例 TENANT_ID；空=未绑定私有化';
