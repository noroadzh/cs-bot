/**
 * ShellProvisioner 单元测试
 *
 * 覆盖：
 *   - 命令组装：docker compose -p csbot-t-<id> -f <path> <args...>（数组传参，不拼 shell）
 *   - 项目名：csbot-t-<tenantId>
 *   - compose 文件路径在 PLATFORM_COMPOSE_DIR 下
 *   - 非零退出 → ProvisionerError，exitCode / stderr 尾部保留
 *   - spawn error（docker 不存在）→ ProvisionerError
 *   - render 产物内容含项目名、端口映射
 *
 * child_process.spawn 与 fs/promises 全部 mock，不依赖真实 docker / 磁盘。
 */
import { describe, it, expect, beforeAll, jest } from '@jest/globals';

const spawnMock = jest.fn() as any;
jest.mock('child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

const fsMkdir = jest.fn() as any;
const fsWriteFile = jest.fn() as any;
jest.mock('fs', () => ({
  promises: { mkdir: fsMkdir, writeFile: fsWriteFile },
  default: { promises: { mkdir: fsMkdir, writeFile: fsWriteFile } },
}));

import { ShellProvisioner, ProvisionerError } from '../src/platform/provisioner/shell-provisioner.js';
import type { Tenant } from '../src/platform/tenant.entity.js';
import { setConfig } from './__setup__/test-helpers.js';

function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: '客户A',
    status: 'created',
    host: '127.0.0.1',
    port: 18001,
    databaseUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    expiredAt: null,
    lastProvisionLog: null,
    deletedAt: null,
    ...over,
  };
}

/** 构造一个 ChildProcess 形状的 mock */
function fakeChild() {
  return {
    stderr: { on: jest.fn() },
    stdout: { on: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
  };
}

/** 让 fakeChild 立刻以 code 正常 close */
function childExits(code: number | null, stderr = '') {
  const child = fakeChild();
  spawnMock.mockImplementationOnce(() => {
    setTimeout(() => {
      const stderrCb = child.stderr.on.mock.calls.find((c: any[]) => c[0] === 'data')?.[1] as any;
      if (stderr) stderrCb?.(Buffer.from(stderr));
      const errCb = child.on.mock.calls.find((c: any[]) => c[0] === 'close')?.[1] as any;
      errCb?.(code);
    }, 0);
    return child;
  });
  return child;
}

describe('ShellProvisioner 命令组装', () => {
  const p = new ShellProvisioner({ PLATFORM_COMPOSE_DIR: 'data/tenants' });

  it('projectName 固定 csbot-t-<id>', () => {
    expect(ShellProvisioner.projectName('abc-123')).toBe('csbot-t-abc-123');
  });

  it('composePath 在 PLATFORM_COMPOSE_DIR/<tenantId>/docker-compose.yml 下', () => {
    const path = p.composePath('t1');
    expect(path).toContain('data');
    expect(path).toContain('tenants');
    expect(path).toContain('t1');
    expect(path.endsWith('docker-compose.yml')).toBe(true);
  });

  it('up 组装 docker compose -p <project> -f <file> up -d（数组传参）', async () => {
    const t = tenant();
    const child = childExits(0);
    await p.up(t);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, argv] = spawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe('docker');
    expect(Array.isArray(argv)).toBe(true);
    expect(argv).toEqual([
      'compose',
      '-p',
      'csbot-t-' + t.id,
      '-f',
      p.composePath(t.id),
      '--env-file',
      expect.stringContaining('tenant.env'),
      'up',
      '-d',
    ]);
  });

  it('stop → compose stop', async () => {
    const t = tenant();
    childExits(0);
    await p.stop(t);
    const [, argv] = spawnMock.mock.calls.at(-1) as [string, string[]];
    expect(argv.slice(-1)).toEqual(['stop']);
  });

  it('start → compose start', async () => {
    const t = tenant();
    childExits(0);
    await p.start(t);
    const [, argv] = spawnMock.mock.calls.at(-1) as [string, string[]];
    expect(argv.slice(-1)).toEqual(['start']);
  });

  it('restart → compose restart adapter', async () => {
    const t = tenant();
    childExits(0);
    await p.restart(t);
    const [, argv] = spawnMock.mock.calls.at(-1) as [string, string[]];
    expect(argv.slice(-2)).toEqual(['restart', 'adapter']);
  });

  it('down(false) → compose down；down(true) → compose down -v', async () => {
    const t = tenant();
    childExits(0);
    await p.down(t, false);
    let argv = (spawnMock.mock.calls.at(-1) as [string, string[]])[1];
    expect(argv.slice(-1)).toEqual(['down']);

    childExits(0);
    await p.down(t, true);
    argv = (spawnMock.mock.calls.at(-1) as [string, string[]])[1];
    expect(argv.slice(-2)).toEqual(['down', '-v']);
  });

  it('PLATFORM_DOCKER_BIN 覆盖 docker 可执行文件', async () => {
    const prev = process.env.PLATFORM_DOCKER_BIN;
    process.env.PLATFORM_DOCKER_BIN = '/usr/local/bin/fake-docker';
    try {
      const t = tenant();
      childExits(0);
      await p.up(t);
      const [bin] = spawnMock.mock.calls.at(-1) as [string, string[]];
      expect(bin).toBe('/usr/local/bin/fake-docker');
    } finally {
      if (prev === undefined) delete process.env.PLATFORM_DOCKER_BIN;
      else process.env.PLATFORM_DOCKER_BIN = prev;
    }
  });
});

describe('ShellProvisioner 失败路径', () => {
  const p = new ShellProvisioner({ PLATFORM_COMPOSE_DIR: 'data/tenants' });

  it('非零退出 → ProvisionerError 带 exitCode 与 stderr 尾部', async () => {
    const t = tenant();
    childExits(1, 'port is already allocated');
    await expect(p.up(t)).rejects.toMatchObject({
      name: 'ProvisionerError',
      exitCode: 1,
      stderrTail: 'port is already allocated',
    });
  });

  it('signal 退出（code=null）→ ProvisionerError exitCode null', async () => {
    const t = tenant();
    childExits(null, 'killed by signal');
    await expect(p.up(t)).rejects.toMatchObject({
      name: 'ProvisionerError',
      exitCode: null,
    });
  });

  it('spawn error（docker 不存在）→ ProvisionerError', async () => {
    const t = tenant();
    const child = fakeChild();
    spawnMock.mockImplementationOnce(() => {
      setTimeout(() => {
        const errCb = child.on.mock.calls.find((c: any[]) => c[0] === 'error')?.[1];
        const errCbFn = errCb as any;
        errCbFn?.(new Error('spawn /usr/local/bin/fake-docker ENOENT'));
      }, 0);
      return child;
    });
    await expect(p.up(t)).rejects.toMatchObject({
      name: 'ProvisionerError',
      exitCode: null,
    });
  });
});

describe('ShellProvisioner.render', () => {
  const p = new ShellProvisioner({ PLATFORM_COMPOSE_DIR: 'data/tenants' });

  it('产物含项目名、TENANT_ID、端口映射，并落盘到 tenantDir', async () => {
    const t = tenant();
    await p.render(t);
    expect(fsMkdir).toHaveBeenCalledWith(expect.stringContaining(t.id), { recursive: true });
    const [path, content] = fsWriteFile.mock.calls.at(-1) as [string, string];
    expect(path).toContain(t.id);
    expect(content).toContain('name: csbot-t-' + t.id);
    expect(content).toContain('TENANT_ID=' + t.id);
    expect(content).toContain('"18001:443"');
    expect(content).not.toContain('"18002:8443"');
    const nginxCall = fsWriteFile.mock.calls.find(([p]) => String(p).endsWith('nginx.conf')) as [string, string];
    expect(nginxCall[1]).not.toContain('listen 8443 ssl;');
    // 六服务与资源隔离（概设 M11）
    const net = 'csbot-t-' + t.id + '-net';
    expect(content).toContain(net);
    for (const svc of ['nginx', 'adapter', 'fastgpt', 'pg', 'mongo', 'redis']) {
      expect(content).toContain(`  ${svc}:`);
    }
    expect(content).toContain('POSTGRES_DB=csbot');
    expect(content).toContain('env_file:');
    expect(content).toContain('tenant.env');
    expect(content).toContain('/app/license:ro');
    expect(content).toContain('docker-entrypoint-initdb.d');
    expect(content).toContain('networks:');
  });

  it('TENANT_ADMIN_ALLOW_CIDRS 非空时开放 8443 并写入 allow/deny', async () => {
    fsWriteFile.mockClear();
    fsMkdir.mockClear();
    setConfig({ TENANT_ADMIN_ALLOW_CIDRS: '203.0.113.0/24,10.1.0.0/16' });
    try {
      await p.render(tenant());
      const [path, content] = fsWriteFile.mock.calls.at(-1) as [string, string];
      expect(path).toContain('docker-compose.yml');
      expect(content).toContain('"18002:8443"');
      const nginxCall = fsWriteFile.mock.calls.find(([p]) => String(p).endsWith('nginx.conf')) as [string, string];
      expect(nginxCall[1]).toContain('listen 8443 ssl;');
      expect(nginxCall[1]).toContain('allow 203.0.113.0/24;');
      expect(nginxCall[1]).toContain('allow 10.1.0.0/16;');
      expect(nginxCall[1]).toContain('deny all;');
    } finally {
      setConfig();
    }
  });
});
