-- miss_record 增补：多媒体类型与处理状态（增项 A/B）
-- 幂等：ADD COLUMN IF NOT EXISTS

ALTER TABLE miss_record
  ADD COLUMN IF NOT EXISTS media_type VARCHAR(16),
  ADD COLUMN IF NOT EXISTS status SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN miss_record.media_type IS 'voice/video/file；文本未命中为空';
COMMENT ON COLUMN miss_record.status IS '0 未处理 / 1 已补录 / 2 忽略';
