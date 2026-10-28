-- M10 导入：条目级去重、会话元数据、阶段计数、单任务租约
-- 序号: 014
-- 幂等：ALTER ... IF NOT EXISTS / CREATE ... IF NOT EXISTS

-- 条目级去重键与会话元数据
ALTER TABLE import_item
    ADD COLUMN IF NOT EXISTS source_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS session_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

-- 丢弃条目正文可清空
ALTER TABLE import_item ALTER COLUMN question DROP NOT NULL;
ALTER TABLE import_item ALTER COLUMN answer_raw DROP NOT NULL;
ALTER TABLE import_item ALTER COLUMN answer_redacted DROP NOT NULL;

ALTER TABLE import_job DROP CONSTRAINT IF EXISTS chk_import_job_status;
ALTER TABLE import_job ADD CONSTRAINT chk_import_job_status
    CHECK (status IN ('uploaded', 'parsing', 'parsed', 'failed', 'approved', 'partial', 'rejected', 'rolled_back'));

-- review_status 允许 modified / needs-fix
ALTER TABLE import_item DROP CONSTRAINT IF EXISTS chk_import_item_review_status;
ALTER TABLE import_item ADD CONSTRAINT chk_import_item_review_status
    CHECK (review_status IN ('pending', 'approved', 'modified', 'rejected', 'needs-fix'));

-- 同一问答对全局唯一（历史数据回填后生效；NULL 不参与）
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_item_source_hash
    ON import_item(source_hash) WHERE source_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_import_item_session
    ON import_item(job_id, session_hash);

-- 任务阶段计数
ALTER TABLE import_job
    ADD COLUMN IF NOT EXISTS total_msgs INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS parsed_msgs INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS masked_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS blocked_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dedup_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS approved_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS imported_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS manifest_generated_at TIMESTAMPTZ;

-- 单任务租约（单行；heartbeat 过期后可由任一进程接管）
CREATE TABLE IF NOT EXISTS import_lock (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    job_id UUID,
    stage VARCHAR(20) NOT NULL,
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
