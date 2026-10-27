# Spec Delta: tenant-provisioning

## Purpose

定义租户实例的完整开通编排：独立数据库/Redis/Mongo/数据目录、TLS 证书、订阅期授权证书、租户密钥库，以及失败回滚，使平台能一次开通一个物理隔离、可授权、可追溯的租户实例。

## ADDED Requirements

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
