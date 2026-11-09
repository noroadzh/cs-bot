/** AdminIdentityService — DB users + roles for management Basic Auth */
import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import type { AdminRole } from './admin-roles.js';
import { hashPassword, verifyPassword } from './password-hasher.js';

export interface AdminUserRow {
  id: string;
  username: string;
  roleCode: AdminRole;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  roleCode: AdminRole;
}

@Injectable()
export class AdminIdentityService implements OnModuleDestroy {
  private readonly logger = new AppLogger('AdminIdentityService');
  private readonly pool: Pool;

  constructor(_config: ConfigService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  async authenticate(username: string, password: string): Promise<AuthenticatedAdmin | null> {
    const u = this.normalizeUsername(username);
    if (!u || !password) return null;
    const res = await this.pool.query<{
      id: string;
      username: string;
      password_hash: string;
      role_code: string;
      enabled: boolean;
    }>(
      `SELECT id, username, password_hash, role_code, enabled FROM admin_user WHERE username = $1 LIMIT 1`,
      [u],
    );
    const row = res.rows[0];
    if (!row || !row.enabled) return null;
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return null;
    return {
      id: row.id,
      username: row.username,
      roleCode: row.role_code as AdminRole,
    };
  }

  async listUsers(filters: { limit?: number; offset?: number } = {}): Promise<{
    total: number;
    limit: number;
    offset: number;
    rows: AdminUserRow[];
  }> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const countRes = await this.pool.query<{ c: string }>(`SELECT count(*)::text AS c FROM admin_user`);
    const total = Number(countRes.rows[0]?.c ?? 0);
    const res = await this.pool.query<{
      id: string;
      username: string;
      role_code: string;
      enabled: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, username, role_code, enabled, created_at, updated_at
       FROM admin_user ORDER BY created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return { total, limit, offset, rows: res.rows.map((r) => this.mapUser(r)) };
  }

  async createUser(input: {
    username: string;
    password: string;
    roleCode: AdminRole;
  }): Promise<AdminUserRow> {
    const username = this.normalizeUsername(input.username);
    if (!username) {
      throw new HttpException({ errCode: 'USER_INVALID', detail: 'username required' }, HttpStatus.BAD_REQUEST);
    }
    if (!input.password || input.password.length < 8) {
      throw new HttpException(
        { errCode: 'USER_INVALID', detail: 'password min length 8' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (input.roleCode !== 'admin' && input.roleCode !== 'operator') {
      throw new HttpException({ errCode: 'USER_INVALID', detail: 'unknown role' }, HttpStatus.BAD_REQUEST);
    }
    const passwordHash = await hashPassword(input.password);
    try {
      const res = await this.pool.query<{
        id: string;
        username: string;
        role_code: string;
        enabled: boolean;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO admin_user (username, password_hash, role_code, enabled)
         VALUES ($1, $2, $3, TRUE)
         RETURNING id, username, role_code, enabled, created_at, updated_at`,
        [username, passwordHash, input.roleCode],
      );
      return this.mapUser(res.rows[0]);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        throw new HttpException({ errCode: 'USER_USERNAME_TAKEN', detail: 'username taken' }, HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  async updateUser(
    id: string,
    patch: { password?: string; roleCode?: AdminRole; enabled?: boolean },
  ): Promise<AdminUserRow> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new HttpException({ errCode: 'USER_NOT_FOUND' }, HttpStatus.NOT_FOUND);
    }
    const nextRole = patch.roleCode ?? existing.roleCode;
    const nextEnabled = patch.enabled ?? existing.enabled;
    if (existing.roleCode === 'admin' && existing.enabled) {
      if (nextRole !== 'admin' || nextEnabled === false) {
        const admins = await this.countEnabledAdmins();
        if (admins <= 1) {
          throw new HttpException(
            { errCode: 'LAST_ADMIN_FORBIDDEN', detail: 'cannot demote or disable last admin' },
            HttpStatus.CONFLICT,
          );
        }
      }
    }
    let passwordHash: string | undefined;
    if (patch.password !== undefined) {
      if (patch.password.length < 8) {
        throw new HttpException(
          { errCode: 'USER_INVALID', detail: 'password min length 8' },
          HttpStatus.BAD_REQUEST,
        );
      }
      passwordHash = await hashPassword(patch.password);
    }
    if (patch.roleCode && patch.roleCode !== 'admin' && patch.roleCode !== 'operator') {
      throw new HttpException({ errCode: 'USER_INVALID', detail: 'unknown role' }, HttpStatus.BAD_REQUEST);
    }
    const res = await this.pool.query<{
      id: string;
      username: string;
      role_code: string;
      enabled: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE admin_user SET
         password_hash = COALESCE($2, password_hash),
         role_code = $3,
         enabled = $4,
         updated_at = now()
       WHERE id = $1
       RETURNING id, username, role_code, enabled, created_at, updated_at`,
      [id, passwordHash ?? null, nextRole, nextEnabled],
    );
    return this.mapUser(res.rows[0]);
  }

  async disableUser(id: string): Promise<AdminUserRow> {
    return this.updateUser(id, { enabled: false });
  }

  async countEnabledAdmins(): Promise<number> {
    const res = await this.pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM admin_user WHERE role_code = 'admin' AND enabled = TRUE`,
    );
    return Number(res.rows[0]?.c ?? 0);
  }

  async getById(id: string): Promise<AdminUserRow | null> {
    const res = await this.pool.query<{
      id: string;
      username: string;
      role_code: string;
      enabled: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, username, role_code, enabled, created_at, updated_at FROM admin_user WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? this.mapUser(res.rows[0]) : null;
  }

  private mapUser(r: {
    id: string;
    username: string;
    role_code: string;
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
  }): AdminUserRow {
    return {
      id: r.id,
      username: r.username,
      roleCode: r.role_code as AdminRole,
      enabled: r.enabled,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}
