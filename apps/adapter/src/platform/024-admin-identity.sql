-- admin identity + request-level audit (keep in sync with admin/024-admin-identity.sql)
CREATE TABLE IF NOT EXISTS admin_role (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO admin_role (code, name) VALUES
  ('admin', 'Administrator'),
  ('operator', 'Operator')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_code TEXT NOT NULL REFERENCES admin_role(code),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_user_username_lower CHECK (username = lower(username))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_user_username ON admin_user (username);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NULL,
  username TEXT NOT NULL,
  role_code TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INT NOT NULL,
  cost_ms INT NOT NULL DEFAULT 0,
  client_ip TEXT NOT NULL DEFAULT '',
  surface TEXT NOT NULL CHECK (surface IN ('admin', 'platform')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_username_created ON admin_audit_log (username, created_at DESC);
