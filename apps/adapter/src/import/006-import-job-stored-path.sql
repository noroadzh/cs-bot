-- 006-import-job-stored-path.sql
-- M10 3.3: parseJob 需要从 job 反查落盘路径，避免客户端回传 storedPath
-- （客户端回传 = 任意文件读取漏洞：客户端可传 /etc/passwd 让解析器读盘）。
-- 可空以兼容 003 建的存量行；存量行因无路径不可再触发 parse，只能删除重建。

ALTER TABLE import_job
    ADD COLUMN IF NOT EXISTS stored_path TEXT,
    ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100);

COMMENT ON COLUMN import_job.stored_path IS '上传/下载文件的落盘路径；NULL = 存量行或文件已清理，不可触发 parse';
COMMENT ON COLUMN import_job.mime_type IS '归一后的 MIME，parse 时选解析器';
