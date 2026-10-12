-- miss_record 表 DDL
CREATE TABLE IF NOT EXISTS miss_record (
  id BIGSERIAL PRIMARY KEY,
  trace_id VARCHAR(64) NOT NULL,
  chat_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  question TEXT NOT NULL,
  score DECIMAL(5,4) NOT NULL,
  engine VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_miss_status_created
  ON miss_record (created_at DESC);

COMMENT ON TABLE miss_record IS '未命中记录表（机器人无法回答的问题）';
