# tenant-provisioning Specification

## Purpose
定义租户实例的完整开通编排：独立数据库/Redis/Mongo/数据目录、TLS 证书、订阅期授权证书、租户密钥库，以及失败回滚，使平台能一次开通一个物理隔离、可授权、可追溯的租户实例。

## Requirements

### Requirement: Isolated resource provisioning

The system MUST initialize per-tenant isolated resources — database `tenant_<id>`, independent Redis/Mongo instances, and data directory `/data/tenants/<id>/` — and MUST NOT share a database instance or network across tenants.

#### Scenario: Isolated resources created

- **WHEN** provision runs for tenant `t-1`
- **THEN** an isolated database, Redis/Mongo instance, and data directory are created under a distinct compose project name

### Requirement: TLS certificate provisioning

The system MUST request or issue a TLS certificate for the tenant domain (wildcard+SNI or dedicated subdomain), and MUST fail the provision and roll back when certificate issuance fails.

#### Scenario: TLS issued

- **WHEN** provision runs for a tenant
- **THEN** the tenant domain has a valid certificate bound to its instance

### Requirement: Subscription license issuance

The system MUST call the M9 license issuance to produce a subscription-period license bound to the instance fingerprint, and persist it on the tenant record.

#### Scenario: License bound to instance

- **WHEN** provision succeeds
- **THEN** the tenant holds a license bound to its fingerprint and subscription expiry

### Requirement: Tenant secret store

The system MUST store each tenant's `.env` (WeCom/LLM/FastGPT secrets) encrypted (AES-256 with a master key, file mode 600) and MUST NOT write plaintext secrets to logs.

#### Scenario: Secrets encrypted at rest

- **WHEN** tenant secrets are written
- **THEN** they are stored as ciphertext and can be decrypted for instance use

### Requirement: Provision rollback

The system MUST roll back already-created resources when any provisioning step fails (retaining the scene for diagnosis), set `status=provisioning_failed`, and allow retry.

#### Scenario: Failure rolls back

- **WHEN** certificate issuance fails during provision
- **THEN** created resources are rolled back and the tenant is `provisioning_failed`

### Requirement: FastGPT initialization handoff

Provisioning MUST provide a documented, idempotent path to finish FastGPT initialization (model channel and API key) and update the tenant secret bundle, without re-provisioning the tenant.

#### Scenario: API key updated

- **WHEN** the operator updates the FastGPT API key after FastGPT starts
- **THEN** the tenant adapter is restarted/reloaded and uses the new key

#### Scenario: Local channel configured

- **WHEN** `MODEL_MODE=local|hybrid` is selected
- **THEN** the runbook requires the FastGPT local model channel to be configured before serving

### Requirement: Tenant admin console exposure control

The provisioned tenant FastGPT admin console MUST NOT be reachable from arbitrary public addresses by default. The rendered tenant nginx MUST either omit the admin listener or restrict it to `TENANT_ADMIN_ALLOW_CIDRS` (empty by default means disabled), deny all other sources, and the provisioning report MUST state whether the admin console is enabled and for which CIDRs.

#### Scenario: Admin console disabled by default

- **WHEN** a tenant is provisioned without `TENANT_ADMIN_ALLOW_CIDRS`
- **THEN** the tenant's admin port is not publicly reachable and the provisioning report says it is disabled

#### Scenario: Allowlisted CIDR reaches the console

- **WHEN** `TENANT_ADMIN_ALLOW_CIDRS=203.0.113.0/24` and a client in that range connects to the tenant admin port
- **THEN** nginx admits the request to FastGPT

#### Scenario: Non-allowlisted source denied

- **WHEN** a client outside `TENANT_ADMIN_ALLOW_CIDRS` connects to the tenant admin port
- **THEN** nginx returns HTTP 403 without proxying to FastGPT

### Requirement: Provisioning credential handoff

When provisioning generates administrator credentials, the system MUST return them exactly once in the provisioning response (or a dedicated one-time handoff endpoint), MUST NOT write their plaintext to logs or audit payloads, and MUST NOT expose them again through any later read or list endpoint. An operator MUST be able to rotate them through the tenant secrets update API.

#### Scenario: Generated credentials returned once

- **WHEN** a tenant is provisioned with generated admin and FastGPT root passwords
- **THEN** the provisioning response contains them once and subsequent tenant detail or secrets reads do not

#### Scenario: Plaintext never logged

- **WHEN** provisioning returns generated credentials
- **THEN** logs and audit entries contain key names only, never the values

#### Scenario: Rotation after handoff

- **WHEN** an operator updates a generated credential through the secrets API
- **THEN** the new value is stored encrypted and the old one is no longer used by the instance after restart/reload

### Requirement: Per-tenant resource hard limits

Every rendered tenant compose MUST declare a memory limit for each of its six services. The `standard` plan MUST stay within the 4C8G budget. The `enhanced` plan MUST stay within the 8C16G budget.

#### Scenario: Rendered compose is bounded

- **WHEN** the control plane renders a tenant compose file
- **THEN** each of nginx, adapter, fastgpt, pg, mongo, and redis declares `mem_limit`

#### Scenario: Standard plan stays within the standard profile

- **WHEN** the tenant plan is `standard` or empty
- **THEN** the summed memory limits do not exceed 6500 MB

#### Scenario: Enhanced plan uses the larger profile

- **WHEN** the tenant plan is `enhanced`
- **THEN** the summed memory limits are greater than the standard profile and do not exceed 16384 MB
