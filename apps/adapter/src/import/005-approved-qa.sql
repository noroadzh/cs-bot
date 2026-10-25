-- Approved QA entries for M10/M11 platform import workflow
-- Part of change add-m10-import-m11-platform
--
-- 已通过审核的 QA 对，ask 时优先检索。uuid 由应用层生成（与 import_job 一致），
-- 检索走 ILIKE 模糊匹配（小文本无需 gin_trgm 扩展，依赖最小化）。
CREATE TABLE IF NOT EXISTS approved_qa (
    id UUID PRIMARY KEY,
    question TEXT NOT NULL UNIQUE,
    answer TEXT NOT NULL,
    source_job_id UUID REFERENCES import_job(id) ON DELETE SET NULL,
    source_item_id UUID REFERENCES import_item(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 检索在应用层做归一化相似度（MVP 量级几百条，全表拉取内存匹配即可；
-- PG 侧 btree 对 %xx% ILIKE 无效，不上假索引）。
CREATE INDEX IF NOT EXISTS idx_approved_qa_source_job_id ON approved_qa(source_job_id);