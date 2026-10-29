-- M11：租户联系人（升级/到期通知触达）
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS contact VARCHAR(255);
