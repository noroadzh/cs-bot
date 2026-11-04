-- LoRA / 微调任务（控制面；不进消息热路径）
CREATE TABLE IF NOT EXISTS finetune_job (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  base_model TEXT,
  artifact_uri TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_finetune_job_status_created
  ON finetune_job (status, created_at DESC);

COMMENT ON TABLE finetune_job IS '微调任务状态机；complete 后登记模型目录';
