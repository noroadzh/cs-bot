-- M10 导入重管线（增项 B 补齐）
-- 序号: 007
-- 幂等：CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS

-- 任务阶段计数 + 数据集名
ALTER TABLE import_job
    ADD COLUMN IF NOT EXISTS cleaned_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paired_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unpaired_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dataset_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS source_shape VARCHAR(40);

-- 条目：数据集写入结果 + 黑名单/近似
ALTER TABLE import_item
    ADD COLUMN IF NOT EXISTS imported_qa_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS auto_blocked BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS similar_qa_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS suggest_action VARCHAR(20);

-- 未配对消息池（不自动入库，供人工补配）
CREATE TABLE IF NOT EXISTS import_unpaired (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
    conversation_id VARCHAR(255),
    sender_id VARCHAR(255),
    content TEXT NOT NULL,
    occurred_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_unpaired_job ON import_unpaired(job_id);
CREATE INDEX IF NOT EXISTS idx_import_item_imported_qa
    ON import_item(imported_qa_id) WHERE imported_qa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_import_item_auto_blocked
    ON import_item(auto_blocked) WHERE auto_blocked = true;
