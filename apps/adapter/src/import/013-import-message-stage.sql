-- 流式导入暂存：会话消息先落库排序，再按窗口增量配对（避免整文件/全量数组驻留内存）
CREATE TABLE IF NOT EXISTS import_message_stage (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
    conversation_id VARCHAR(255) NOT NULL,
    sender_id VARCHAR(255) NOT NULL,
    sender_type VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_stage_job_order
    ON import_message_stage(job_id, conversation_id, occurred_at, id);
