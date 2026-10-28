/**
 * TenantOffboarding — M11 注销编排（概设 §5 M11 / PRD FR-12）
 *
 * 流程：export 生成加密包 + 一次性 confirmToken → destroy 双签 + 令牌校验，
 * 置 offboarding 并计划 T+7 删除 → sweep 到期执行删除并写确认单。
 */
import { createHash, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import { TenantStateMachine } from './tenant.state-machine.js';
import type { PlatformAuditAction, TenantStatus } from './tenant.entity.js';

export type OffboardingStatus = 'exported' | 'offboarding' | 'destroyed';

export interface OffboardingRecord {
  tenantId: string;
  status: OffboardingStatus;
  approvals: string[];
  confirmTokenHash: string | null;
  tokenExpiresAt: string | null;
  exportPath: string | null;
  deleteAfter: string | null;
}

export interface OffboardingRepo {
  getTenantStatus(tenantId: string): Promise<TenantStatus | null>;
  get(tenantId: string): Promise<OffboardingRecord | null>;
  saveExport(
    tenantId: string,
    data: { exportPath: string; tokenHash: string; tokenExpiresAt: string },
  ): Promise<void>;
  schedule(tenantId: string, approvals: string[], deleteAfter: string): Promise<void>;
  setTenantStatus(tenantId: string, status: TenantStatus): Promise<void>;
  due(nowIso: string): Promise<string[]>;
  markDestroyed(
    tenantId: string,
    data: { approvals: string[]; exportPath: string | null; deletedAt: string },
  ): Promise<void>;
}

export interface OffboardingAudit {
  append(entry: {
    action: PlatformAuditAction;
    actor: string;
    tenantId: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface OffboardingDeps {
  repo: OffboardingRepo;
  exportPackage(tenantId: string): Promise<string>;
  deleteTenant(tenantId: string): Promise<void>;
  audit: OffboardingAudit;
  now?: () => Date;
  tokenFactory?: () => string;
  /** 令牌有效期，默认 24h */
  tokenTtlMs?: number;
}

export interface ExportResult {
  path: string;
  confirmToken: string;
  expiresAt: string;
}

export interface DestroyResult {
  status: 'offboarding' | 'terminated';
  scheduledAt?: string;
  approvals?: number;
  deleted?: boolean;
}

export interface DestroyDueResult {
  deleted: string[];
  failed: Array<{ tenantId: string; error: string }>;
}

export class OffboardingBlockedException extends HttpException {
  readonly code = 'TENANT_OFFBOARDING_BLOCKED';
  constructor(
    readonly tenantId: string,
    readonly approvals: number,
  ) {
    super(
      {
        errCode: 'TENANT_OFFBOARDING_BLOCKED',
        detail: `dual sign-off required: got ${approvals} distinct approval(s)`,
        tenantId,
      },
      HttpStatus.CONFLICT,
    );
    this.name = 'OffboardingBlockedException';
  }
}

function tokenError(code: string, detail: string): HttpException {
  return new HttpException({ errCode: code, detail }, HttpStatus.BAD_REQUEST);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const OFFBOARDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export class TenantOffboarding {
  private readonly now: () => Date;
  private readonly tokenFactory: () => string;
  private readonly tokenTtlMs: number;

  constructor(private readonly deps: OffboardingDeps) {
    this.now = deps.now ?? (() => new Date());
    this.tokenFactory = deps.tokenFactory ?? (() => randomBytes(32).toString('base64url'));
    this.tokenTtlMs = deps.tokenTtlMs ?? DEFAULT_TTL_MS;
  }

  async export(tenantId: string): Promise<ExportResult> {
    const status = await this.deps.repo.getTenantStatus(tenantId);
    if (status === null) {
      throw new HttpException(
        { errCode: 'TENANT_NOT_FOUND', detail: `tenant ${tenantId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    if (status === 'terminated' || status === 'offboarding') {
      throw new HttpException(
        { errCode: 'TENANT_NOT_EXPORTABLE', detail: `tenant is ${status}`, status },
        HttpStatus.CONFLICT,
      );
    }
    const path = await this.deps.exportPackage(tenantId);
    const token = this.tokenFactory();
    const expiresAt = new Date(this.now().getTime() + this.tokenTtlMs).toISOString();
    await this.deps.repo.saveExport(tenantId, {
      exportPath: path,
      tokenHash: hashToken(token),
      tokenExpiresAt: expiresAt,
    });
    await this.deps.audit.append({
      action: 'tenant.export',
      actor: 'platform',
      tenantId,
      payload: { exportPath: path },
    });
    return { path, confirmToken: token, expiresAt };
  }

  async destroy(
    tenantId: string,
    approvals: readonly string[],
    confirmToken?: string,
  ): Promise<DestroyResult> {
    const status = await this.deps.repo.getTenantStatus(tenantId);
    if (status === null) {
      throw new HttpException(
        { errCode: 'TENANT_NOT_FOUND', detail: `tenant ${tenantId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    const record = await this.deps.repo.get(tenantId);
    if (status === 'terminated' || record?.status === 'destroyed') {
      return { status: 'terminated', deleted: true };
    }
    if (record?.status === 'offboarding' && record.deleteAfter) {
      return {
        status: 'offboarding',
        scheduledAt: record.deleteAfter,
        approvals: record.approvals.length,
      };
    }
    if (!confirmToken) {
      throw tokenError('OFFBOARDING_TOKEN_REQUIRED', 'confirmToken is required');
    }
    const distinct = [...new Set(approvals.filter((a) => typeof a === 'string' && a.trim()))];
    if (distinct.length < 2) {
      throw new OffboardingBlockedException(tenantId, distinct.length);
    }
    if (!record || !record.confirmTokenHash) {
      throw new HttpException(
        { errCode: 'TENANT_NOT_EXPORTED', detail: 'export the tenant before destroying it' },
        HttpStatus.CONFLICT,
      );
    }
    if (
      record.tokenExpiresAt === null ||
      new Date(record.tokenExpiresAt).getTime() < this.now().getTime() ||
      hashToken(confirmToken) !== record.confirmTokenHash
    ) {
      throw tokenError('OFFBOARDING_TOKEN_INVALID', 'confirmToken is invalid or expired');
    }

    TenantStateMachine.assertTransition(status, 'offboarding');
    const scheduledAt = new Date(this.now().getTime() + OFFBOARDING_WINDOW_MS).toISOString();
    await this.deps.repo.schedule(tenantId, distinct, scheduledAt);
    await this.deps.repo.setTenantStatus(tenantId, 'offboarding');
    await this.deps.audit.append({
      action: 'tenant.destroy_scheduled',
      actor: 'platform',
      tenantId,
      payload: { scheduledAt, approvals: distinct.length },
    });
    return { status: 'offboarding', scheduledAt, approvals: distinct.length };
  }

  /** 由 sweep 调用：删除到期租户并写确认单，单租户失败不影响其他租户 */
  async destroyDue(now: Date = this.now()): Promise<DestroyDueResult> {
    const ids = await this.deps.repo.due(now.toISOString());
    const deleted: string[] = [];
    const failed: Array<{ tenantId: string; error: string }> = [];
    for (const tenantId of ids) {
      const record = await this.deps.repo.get(tenantId);
      try {
        await this.deps.deleteTenant(tenantId);
        await this.deps.repo.markDestroyed(tenantId, {
          approvals: record?.approvals ?? [],
          exportPath: record?.exportPath ?? null,
          deletedAt: now.toISOString(),
        });
        await this.deps.audit.append({
          action: 'tenant.destroyed',
          actor: 'system:sweep',
          tenantId,
          payload: { deletedAt: now.toISOString(), exportPath: record?.exportPath ?? null },
        });
        deleted.push(tenantId);
      } catch (err) {
        failed.push({ tenantId, error: (err as Error).message });
      }
    }
    return { deleted, failed };
  }
}
