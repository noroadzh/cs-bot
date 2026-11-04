-- 自动学习 / 审核入库审计（可查询）
CREATE TABLE IF NOT EXISTS learning_audit (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  action VARCHAR(32) NOT NULL,
  cluster_key TEXT,
  question TEXT,
  answer TEXT,
  risk VARCHAR(8),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_audit_tenant_created
  ON learning_audit (tenant_id, created_at DESC);

COMMENT ON TABLE learning_audit IS '学习闭环自动入库与人工审核审计';
