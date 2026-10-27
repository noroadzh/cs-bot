-- 租户端口分配序列（设计：30000 + 每租户 10 段）
CREATE SEQUENCE IF NOT EXISTS tenant_port_seq START WITH 30000 INCREMENT BY 10;
ALTER TABLE tenant ALTER COLUMN port SET DEFAULT nextval('tenant_port_seq');
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_port ON tenant(port) WHERE port IS NOT NULL;
