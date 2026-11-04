-- 在线质检持久化（无原文问答）
CREATE TABLE IF NOT EXISTS quality_inspection (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  sensitive_hits INT NOT NULL DEFAULT 0,
  refusals INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0,
  p95_latency_ms INT NOT NULL DEFAULT 0,
  alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
  window_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_inspection_tenant_created
  ON quality_inspection (tenant_id, created_at DESC);

COMMENT ON TABLE quality_inspection IS '在线质检采样：阈值结果与告警摘要，不含会话原文';
