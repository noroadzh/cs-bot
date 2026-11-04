-- import_job 按租户隔离
ALTER TABLE import_job
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_import_job_tenant_created
  ON import_job (tenant_id, created_at DESC);

COMMENT ON COLUMN import_job.tenant_id IS '实例 TENANT_ID；空=未绑定私有化';
