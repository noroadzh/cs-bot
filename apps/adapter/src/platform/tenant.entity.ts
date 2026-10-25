/**
 * Tenant entity interfaces — match 007-tenant.sql column names,
 * mapped to camelCase fields.
 */

export type TenantStatus =
  | 'created'
  | 'provisioning'
  | 'active'
  | 'grace'
  | 'suspended'
  | 'paused'
  | 'terminated'
  | 'provisioning_failed';

export interface Tenant {
  id: string;
  name: string;
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
  | 'tenant.paused-sweep';

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
}

export interface UsageQueryResult {
  rows: UsageDayRow[];
  totals: {
    chatCount: number;
    apiCallCount: number;
    storageBytes: number;
    userCount: number;
  };
}
