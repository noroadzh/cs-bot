-- M10: 导入任务相关表
-- 依赖: 无 (纯新增)
-- 序号: 004

-- 导入任务主表
CREATE TABLE IF NOT EXISTS import_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    source_filename VARCHAR(500),
    source_hash VARCHAR(64) NOT NULL, -- sha256 hex
    status VARCHAR(20) NOT NULL DEFAULT 'uploaded',
    -- status: uploaded, parsing, parsed, failed, approved, partial, rejected
    item_count INTEGER NOT NULL DEFAULT 0,
    parse_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 兼容旧表：error_message → parse_error（service 统一用 parse_error）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_job' AND column_name = 'error_message')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_job' AND column_name = 'parse_error') THEN
    ALTER TABLE import_job RENAME COLUMN error_message TO parse_error;
  END IF;
END $$;

-- 导入条目明细表
CREATE TABLE IF NOT EXISTS import_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer_raw TEXT NOT NULL,
    answer_redacted TEXT,
    sensitive_flags JSONB NOT NULL DEFAULT '[]'::jsonb, -- 命中类型数组：["phone","idcard",...]
    review_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- review_status: pending, approved, rejected
    reviewer_note TEXT,
    reviewer_id UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 兼容旧表：sensitive_flags 由 VARCHAR 迁移为 JSONB（存 JSON 数组，供 jsonb_array_length / 过滤）
-- 先删旧索引（其 WHERE 在 jsonb 下无法解析），再改类型
DROP INDEX IF EXISTS idx_import_item_sensitive;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'import_item' AND column_name = 'sensitive_flags'
      AND data_type <> 'jsonb'
  ) THEN
    ALTER TABLE import_item ALTER COLUMN sensitive_flags DROP DEFAULT;
    ALTER TABLE import_item ALTER COLUMN sensitive_flags TYPE JSONB
      USING (CASE WHEN sensitive_flags IS NULL OR sensitive_flags::text = '' THEN '[]'::jsonb
                  ELSE sensitive_flags::text::jsonb END);
    ALTER TABLE import_item ALTER COLUMN sensitive_flags SET DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- 索引: import_job
CREATE INDEX IF NOT EXISTS idx_import_job_status ON import_job(status);
CREATE INDEX IF NOT EXISTS idx_import_job_created_at ON import_job(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_job_source_hash ON import_job(source_hash) WHERE status IN ('parsed', 'approved', 'partial', 'rejected');

-- 索引: import_item
CREATE INDEX IF NOT EXISTS idx_import_item_job_id ON import_item(job_id);
CREATE INDEX IF NOT EXISTS idx_import_item_review_status ON import_item(review_status);
CREATE INDEX IF NOT EXISTS idx_import_item_sensitive ON import_item(sensitive_flags) WHERE jsonb_array_length(sensitive_flags) > 0;

-- 状态 CHECK 约束（幂等：重复执行自动跳过）
DO $$ BEGIN
    ALTER TABLE import_job ADD CONSTRAINT chk_import_job_status
        CHECK (status IN ('uploaded', 'parsing', 'parsed', 'failed', 'approved', 'partial', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE import_item ADD CONSTRAINT chk_import_item_review_status
        CHECK (review_status IN ('pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;