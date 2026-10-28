# Spec Delta

## MODIFIED Requirements

### Requirement: Basic Auth with IP whitelist

The system MUST require HTTP Basic Auth credentials matching `ADMIN_USER`/`ADMIN_PASSWORD` AND require the source IP to fall within `ALLOWED_ADMIN_IPS` (CIDR list) for every `/admin/*` and `/healthz` management endpoint. The source IP MUST be the socket peer address by default. Forwarded client-IP headers (`X-Forwarded-For`, `X-Real-IP`) MUST be honored only when the socket peer belongs to `TRUSTED_PROXY_CIDRS` (default loopback), and then the effective client is the first address in `X-Forwarded-For` that is not itself a trusted proxy, falling back to `X-Real-IP`. Forwarded headers from an untrusted peer MUST be ignored.

#### Scenario: Valid auth from whitelisted IP

- **WHEN** a request comes from an IP in `ALLOWED_ADMIN_IPS` with correct Basic Auth
- **THEN** the request reaches the handler

#### Scenario: Wrong IP

- **WHEN** a request comes from an IP outside `ALLOWED_ADMIN_IPS`
- **THEN** the system returns HTTP 403 regardless of credentials

#### Scenario: Wrong password

- **WHEN** credentials do not match `ADMIN_USER`/`ADMIN_PASSWORD`
- **THEN** the system returns HTTP 401 with `WWW-Authenticate: Basic`

#### Scenario: Reverse proxy forwards the real client IP

- **WHEN** the nginx container (inside `TRUSTED_PROXY_CIDRS`) forwards a request from a whitelisted operator IP with `X-Forwarded-For`
- **THEN** the whitelist check evaluates the operator IP and admits the request

#### Scenario: Spoofed forwarded header ignored

- **WHEN** a direct client outside `TRUSTED_PROXY_CIDRS` sends `X-Forwarded-For: 127.0.0.1`
- **THEN** the system evaluates the socket peer address and returns HTTP 403 when it is not whitelisted
