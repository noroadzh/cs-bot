/**
 * Tenant entity interfaces — match 007-tenant.sql column names,
 * mapped to camelCase fields.
 */

export type TenantStatus =
  | 'created'
  | 'trialing'
  | 'provisioning'
  | 'active'
  | 'grace'
  | 'suspended'
  | 'paused'
  | 'offboarding'
  | 'terminated'
  | 'provisioning_failed';

export interface Tenant {
  id: string;
  name: string;
  contact?: string | null;
  status: TenantStatus;
  host: string | null;
  port: number | null;
  databaseUrl: string | null;
  createdAt: string;
  updatedAt: string;
  expiredAt: string | null;
  lastProvisionLog: string | null;
  deletedAt: string | null;
}

export interface TenantCreateInput {
  name: string;
  contact?: string;
  /** 租户访问域名（回调/TLS），提供后写入 host */
  domain?: string;
  plan?: string;
  subscriptionExpiresAt?: string;
}

export interface TenantQuota {
  id: string;
  tenantId: string;
  maxChats: number;
  maxStorageMb: number;
  /** 对应 spec 的 max_msgs_per_day（DB 列 max_api_calls） */
  maxApiCalls: number;
  /** 对应 spec 的 max_concurrent_qa（DB 列 max_users） */
  maxUsers: number;
  /** LLM token 月度上限（0 = 不限） */
  maxLlmTokensPerMonth: number;
  maxDocs: number;
  maxQa: number;
  maxAssetMb: number;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUsageDaily {
  id: string;
  tenantId: string;
  day: string;
  chatCount: number;
  apiCallCount: number;
  storageBytes: number;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export type PlatformAuditAction =
  | 'tenant.create'
  | 'tenant.provision'
  | 'tenant.suspend'
  | 'tenant.resume'
  | 'tenant.terminate'
  | 'tenant.renew'
  | 'tenant.quota-set'
  | 'tenant.expired-sweep'
  | 'tenant.paused-sweep'
  | 'tenant.sync'
  | 'tenant.restart'
  | 'tenant.alert'
  | 'tenant.export'
  | 'tenant.destroy_scheduled'
  | 'tenant.destroyed'
  | 'tenant.credentials'
  | 'shell_access';

export interface AuditAppendOpts {
  action: PlatformAuditAction;
  actor: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
}

export interface AuditListFilters {
  tenantId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditListResult {
  total: number;
  limit: number;
  offset: number;
  rows: PlatformAuditLog[];
}

export interface AuditVerifyResult {
  valid: boolean;
  brokenAtId?: string;
  entries: number;
}

export interface TenantQuotaPatch {
  maxChats?: number;
  maxStorageMb?: number;
  maxApiCalls?: number;
  maxUsers?: number;
  maxLlmTokensPerMonth?: number;
  maxDocs?: number;
  maxQa?: number;
  maxAssetMb?: number;
}

export interface QuotaConsumeKind {
  chat: number;
  api_call: number;
  storage: number;
  user: number;
}

export interface UsageDelta {
  chatCount: number;
  apiCallCount: number;
  storageBytes: number;
  userCount: number;
  docCount?: number;
  qaCount?: number;
  assetMb?: number;
}

export interface PlatformAuditLog {
  id: string;
  tenantId: string | null;
  action: string;
  actor: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface TenantDetail {
  tenant: Tenant;
  quota: TenantQuota | null;
  usageToday: {
    chatCount: number;
    apiCallCount: number;
    storageBytes: number;
    userCount: number;
    docCount: number;
    qaCount: number;
    assetMb: number;
  };
}

export interface TenantListResult {
  total: number;
  limit: number;
  offset: number;
  rows: Tenant[];
}

export interface UsageDayRow {
  day: string;
  chatCount: number;
  apiCallCount: number;
  storageBytes: number;
  userCount: number;
  docCount: number;
  qaCount: number;
  assetMb: number;
}

export interface UsageQueryResult {
  rows: UsageDayRow[];
  totals: {
    chatCount: number;
    apiCallCount: number;
    storageBytes: number;
    userCount: number;
    docCount: number;
    qaCount: number;
    assetMb: number;
  };
}
