import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { DataType, newDb } from 'pg-mem';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('AdminIdentityService', () => {
  let identity: any;
  let pool: any;

  beforeAll(async () => {
    setConfig({});
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () =>
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        }),
      impure: true,
    });
    const sql = readFileSync(
      join(process.cwd(), 'src/admin/024-admin-identity.sql'),
      'utf8',
    );
    db.public.none(
      sql
        .replace(/TIMESTAMPTZ/g, 'TIMESTAMP')
        .replace(/BIGSERIAL/g, 'SERIAL'),
    );
    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    const mod = await import('../src/admin/admin-identity.service.js');
    identity = new mod.AdminIdentityService({} as any);
    (identity as any).pool = pool;
  });

  afterAll(async () => {
    await pool?.end?.();
    resetConfig();
  });

  it('creates admin and authenticates', async () => {
    const user = await identity.createUser({
      username: 'RootAdmin',
      password: 'password123',
      roleCode: 'admin',
    });
    expect(user.username).toBe('rootadmin');
    const authed = await identity.authenticate('RootAdmin', 'password123');
    expect(authed?.roleCode).toBe('admin');
    expect(await identity.authenticate('rootadmin', 'bad')).toBeNull();
  });

  it('refuses disabling last admin', async () => {
    const listed = await identity.listUsers();
    const admin = listed.rows.find((u: any) => u.roleCode === 'admin');
    expect(admin).toBeTruthy();
    await expect(identity.disableUser(admin.id)).rejects.toBeInstanceOf(HttpException);
  });

  it('allows operator create', async () => {
    const op = await identity.createUser({
      username: 'ops1',
      password: 'password123',
      roleCode: 'operator',
    });
    expect(op.roleCode).toBe('operator');
    await identity.disableUser(op.id);
    expect((await identity.getById(op.id)).enabled).toBe(false);
  });
});
