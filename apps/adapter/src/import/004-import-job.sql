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
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 导入条目明细表
CREATE TABLE IF NOT EXISTS import_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer_raw TEXT NOT NULL,
    answer_redacted TEXT,
    sensitive_flags VARCHAR(100) DEFAULT '', -- comma-separated: phone,idcard,bankcard,email,url
    review_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- review_status: pending, approved, rejected
    reviewer_note TEXT,
    reviewer_id UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 索引: import_job
CREATE INDEX IF NOT EXISTS idx_import_job_status ON import_job(status);
CREATE INDEX IF NOT EXISTS idx_import_job_created_at ON import_job(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_job_source_hash ON import_job(source_hash) WHERE status IN ('parsed', 'approved', 'partial', 'rejected');

-- 索引: import_item
CREATE INDEX IF NOT EXISTS idx_import_item_job_id ON import_item(job_id);
CREATE INDEX IF NOT EXISTS idx_import_item_review_status ON import_item(review_status);
CREATE INDEX IF NOT EXISTS idx_import_item_sensitive ON import_item(sensitive_flags) WHERE sensitive_flags <> '';

-- 状态 CHECK 约束
ALTER TABLE import_job ADD CONSTRAINT chk_import_job_status
    CHECK (status IN ('uploaded', 'parsing', 'parsed', 'failed', 'approved', 'partial', 'rejected'));

ALTER TABLE import_item ADD CONSTRAINT chk_import_item_review_status
    CHECK (review_status IN ('pending', 'approved', 'rejected'));