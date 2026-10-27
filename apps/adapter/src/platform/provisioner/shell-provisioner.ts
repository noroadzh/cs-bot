/**
 * ShellProvisioner — docker compose 编排的默认实现（design D1）
 *
 * 全部命令走 child_process.spawn 的**数组传参**（不拼 shell 字符串），
 * 避免注入面；compose 项目名固定 `csbot-t-<tenantId>`，两个租户不共享容器/网络。
 * 单条命令超时 60s（design R1），超时杀进程并抛错。
 *
 * 环境变量覆盖（测试用）：
 *   PLATFORM_DOCKER_BIN  docker 可执行文件路径（默认 'docker'）
 */
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';
import { ConfigService } from '../../config/config.service.js';
import type { Tenant } from '../tenant.entity.js';
import type { TenantProvisioner } from './provisioner.js';

/** 单条 compose 命令超时 */
export const COMMAND_TIMEOUT_MS = 60_000;

/** 健康探测间隔 */
const PROBE_INTERVAL_MS = 2_000;

export class ProvisionerError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(message);
    this.name = 'ProvisionerError';
  }
}

export class ShellProvisioner implements TenantProvisioner {
  constructor(private readonly cfg: { PLATFORM_COMPOSE_DIR?: string } = {}) {}

  /** compose 根目录：PLATFORM_COMPOSE_DIR（默认 data/tenants） */
  private get composeRoot(): string {
    const dir =
      this.cfg.PLATFORM_COMPOSE_DIR ??
      (() => {
        try {
          return ConfigService.instance.PLATFORM_COMPOSE_DIR;
        } catch {
          return 'data/tenants';
        }
      })();
    return resolve(process.cwd(), dir);
  }

  /** docker 可执行文件（测试可注入假 docker） */
  private get dockerBin(): string {
    return process.env.PLATFORM_DOCKER_BIN || 'docker';
  }

  /** compose 项目名：csbot-t-<id> */
  static projectName(tenantId: string): string {
    return `csbot-t-${tenantId}`;
  }

  /** per-tenant compose 目录 */
  tenantDir(tenantId: string): string {
    return join(this.composeRoot, tenantId);
  }

  /** compose 文件路径 */
  composePath(tenantId: string): string {
    return join(this.tenantDir(tenantId), 'docker-compose.yml');
  }

  async render(tenant: Tenant): Promise<string> {
    const dir = this.tenantDir(tenant.id);
    await fs.mkdir(dir, { recursive: true });
    const path = this.composePath(tenant.id);
    const port = tenant.port ?? 0;
    const project = ShellProvisioner.projectName(tenant.id);
    const net = `${project}-net`;
    const dbName = `tenant_${tenant.id.replace(/-/g, '_')}`;
    const content = [
      '# 由 cs-bot 平台控制面自动渲染，请勿手工编辑',
      `name: ${project}`,
      'services:',
      '  adapter:',
      '    image: ${CSBOT_IMAGE:-cs-bot/adapter:latest}',
      '    container_name: ' + project,
      '    restart: unless-stopped',
      '    environment:',
      '      - TENANT_ID=' + tenant.id,
      '      - TENANT_NAME=' + (tenant.name ?? ''),
      '      - DATABASE_URL=postgresql://cs:cs@db:5432/' + dbName,
      '      - REDIS_HOST=redis',
      '      - LICENSE_FILE=/app/license/license.lic',
      '    volumes:',
      '      - ' + join(dir, 'data') + ':/app/data',
      '      - ' + join(dir, 'license') + ':/app/license:ro',
      '    ports:',
      '      - "' + port + ':3000"',
      '    networks:',
      '      - ' + net,
      '    depends_on:',
      '      - db',
      '      - redis',
      '  db:',
      '    image: pgvector/pgvector:pg16',
      '    restart: unless-stopped',
      '    environment:',
      '      - POSTGRES_USER=cs',
      '      - POSTGRES_DB=' + dbName,
      '    volumes:',
      '      - ' + join(dir, 'pg') + ':/var/lib/postgresql/data',
      '    networks:',
      '      - ' + net,
      '  redis:',
      '    image: redis:7-alpine',
      '    restart: unless-stopped',
      '    volumes:',
      '      - ' + join(dir, 'redis') + ':/data',
      '    networks:',
      '      - ' + net,
      '  mongo:',
      '    image: mongo:7',
      '    restart: unless-stopped',
      '    volumes:',
      '      - ' + join(dir, 'mongo') + ':/data/db',
      '    networks:',
      '      - ' + net,
      'networks:',
      '  ' + net + ':',
      '    driver: bridge',
      '',
    ].join('\n');
    await fs.writeFile(path, content, 'utf8');
    return path;
  }

  async up(tenant: Tenant): Promise<void> {
    await this.compose(tenant, ['up', '-d']);
  }

  async stop(tenant: Tenant): Promise<void> {
    await this.compose(tenant, ['stop']);
  }

  async start(tenant: Tenant): Promise<void> {
    await this.compose(tenant, ['start']);
  }

  async down(tenant: Tenant, dropVols: boolean): Promise<void> {
    await this.compose(tenant, dropVols ? ['down', '-v'] : ['down']);
  }

  /**
   * 健康探测：轮询 http://<host>:<port>/health 直到返回 healthy 或超时。
   * 探测失败（连接拒绝/非 2xx）不算致命，继续重试直到 timeout。
   */
  async probe(tenant: Tenant, timeoutMs: number): Promise<boolean> {
    const host = tenant.host ?? '127.0.0.1';
    const port = tenant.port ?? 0;
    if (!port) return false;
    const url = `http://${host}:${port}/health`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          const status = body.status ?? body.state;
          if (status === undefined || status === 'ok' || status === 'healthy') return true;
        }
      } catch {
        // 实例还没起来 —— 继续轮询
      }
      await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
    }
    return false;
  }

  /**
   * 组装并执行 compose 命令。
   * 参数全走数组：docker compose -p <project> -f <composeFile> <args...>
   */
  private async compose(tenant: Tenant, args: string[]): Promise<void> {
    const argv = [
      'compose',
      '-p',
      ShellProvisioner.projectName(tenant.id),
      '-f',
      this.composePath(tenant.id),
      ...args,
    ];
    await this.run(this.dockerBin, argv, tenant.id);
  }

  /** spawn + 超时 + stderr 尾部收集 */
  private run(bin: string, argv: string[], tenantId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let stdout = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(
          new ProvisionerError(
            `command timed out after ${COMMAND_TIMEOUT_MS}ms: ${bin} ${argv.join(' ')}`,
            null,
            stderr.slice(-2000),
          ),
        );
      }, COMMAND_TIMEOUT_MS);

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new ProvisionerError(err.message, null, stderr.slice(-2000)));
      });
      child.on('close', (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(
            new ProvisionerError(
              `command failed with exit code ${code}: ${bin} ${argv.join(' ')}`,
              code,
              stderr.slice(-2000),
            ),
          );
        }
      });
    });
  }
}
