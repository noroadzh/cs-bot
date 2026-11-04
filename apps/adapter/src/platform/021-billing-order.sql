-- 自助计费订单（控制面）
CREATE TABLE IF NOT EXISTS billing_order (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  days INTEGER NOT NULL CHECK (days > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('wechat', 'alipay', 'mock')),
  status VARCHAR(16) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_billing_order_tenant
  ON billing_order (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_order_status
  ON billing_order (status) WHERE status = 'created';

COMMENT ON TABLE billing_order IS '自助续费订单；支付成功后走 tenant.renew + 审计';
