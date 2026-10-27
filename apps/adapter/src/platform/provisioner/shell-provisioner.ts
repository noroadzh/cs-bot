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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

  async render(tenant: Tenant, envFile?: string): Promise<string> {
    const dir = this.tenantDir(tenant.id);
    const nginxDir = join(dir, 'nginx');
    const initDir = join(dir, 'initdb');
    for (const d of [
      dir, nginxDir, join(nginxDir, 'certs'), join(nginxDir, 'logs'),
      join(dir, 'data'), join(dir, 'pg'), join(dir, 'mongo'), join(dir, 'redis'),
      join(dir, 'fastgpt-data'), join(dir, 'license'), initDir,
    ]) {
      await fs.mkdir(d, { recursive: true });
    }
    const env = envFile ?? join(dir, 'tenant.env');
    const host = tenant.host ?? tenant.id;
    const port = tenant.port ?? 0;
    const project = ShellProvisioner.projectName(tenant.id);
    const net = `${project}-net`;

    await fs.writeFile(join(nginxDir, 'nginx.conf'), this.nginxConf(host), 'utf8');
    await this.writeInitDb(initDir);

    const content = [
      '# 由 cs-bot 控制面自动渲染，请勿手工编辑',
      `name: ${project}`,
      'services:',
      '  nginx:',
      '    image: nginx:1.27-alpine',
      '    restart: unless-stopped',
      '    ports:',
      `      - "${port}:443"`,
      `      - "${port + 1}:8443"`,
      '    volumes:',
      `      - ${join(nginxDir, 'nginx.conf')}:/etc/nginx/nginx.conf:ro`,
      `      - ${join(nginxDir, 'certs')}:/etc/nginx/certs:ro`,
      `      - ${join(nginxDir, 'logs')}:/var/log/nginx`,
      '    depends_on:',
      '      adapter:',
      '        condition: service_healthy',
      '    networks:',
      `      - ${net}`,
      '  adapter:',
      '    image: ${CSBOT_IMAGE:-cs-bot-adapter:latest}',
      '    container_name: ' + project,
      '    restart: unless-stopped',
      '    env_file:',
      `      - ${env}`,
      '    environment:',
      `      - TENANT_ID=${tenant.id}`,
      `      - TENANT_NAME=${tenant.name ?? ''}`,
      '      - REDIS_HOST=redis',
      '      - REDIS_PASSWORD=${REDIS_PASSWORD}',
      '      - DATABASE_URL=postgresql://cs:${POSTGRES_PASSWORD}@pg:5432/csbot',
      '      - ADMIN_PASSWORD=${ADMIN_PASSWORD}',
      '      - FASTGPT_BASE_URL=http://fastgpt:3000',
      '      - LICENSE_FILE=/app/license/license.lic',
      '    volumes:',
      `      - ${join(dir, 'data')}:/app/data`,
      `      - ${join(dir, 'license')}:/app/license:ro`,
      '    extra_hosts:',
      '      - "host.docker.internal:host-gateway"',
      '    healthcheck:',
      `      test: ["CMD", "/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`,
      '      interval: 10s',
      '      timeout: 5s',
      '      retries: 12',
      '    depends_on:',
      '      pg:',
      '        condition: service_healthy',
      '      redis:',
      '        condition: service_healthy',
      '      fastgpt:',
      '        condition: service_started',
      '    networks:',
      `      - ${net}`,
      '  fastgpt:',
      '    image: labring/fastgpt:v4.8.17',
      '    restart: unless-stopped',
      '    env_file:',
      `      - ${env}`,
      '    environment:',
      '      - MONGODB_URI=mongodb://mongo:27017/fastgpt',
      '      - PG_URL=postgresql://cs:${POSTGRES_PASSWORD}@pg:5432/fastgpt',
      '      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/1',
      '      - DEFAULT_ROOT_PSW=${FASTGPT_ROOT_PASSWORD}',
      '      - FILE_TOKEN=${FASTGPT_FILE_TOKEN}',
      '      - TOKEN_KEY=${FASTGPT_TOKEN_KEY}',
      '      - ROOT_KEY=${FASTGPT_ROOT_KEY}',
      '    volumes:',
      `      - ${join(dir, 'fastgpt-data')}:/data`,
      '    depends_on:',
      '      pg:',
      '        condition: service_healthy',
      '      mongo:',
      '        condition: service_started',
      '      redis:',
      '        condition: service_healthy',
      '    networks:',
      `      - ${net}`,
      '  pg:',
      '    image: pgvector/pgvector:pg16',
      '    restart: unless-stopped',
      '    env_file:',
      `      - ${env}`,
      '    environment:',
      '      - POSTGRES_USER=cs',
      '      - POSTGRES_DB=csbot',
      '    volumes:',
      `      - ${join(dir, 'pg')}:/var/lib/postgresql/data`,
      `      - ${join(initDir)}:/docker-entrypoint-initdb.d:ro`,
      '    healthcheck:',
      '      test: ["CMD-SHELL", "pg_isready -U cs -d csbot"]',
      '      interval: 5s',
      '      timeout: 3s',
      '      retries: 20',
      '    networks:',
      `      - ${net}`,
      '  mongo:',
      '    image: mongo:7',
      '    restart: unless-stopped',
      '    volumes:',
      `      - ${join(dir, 'mongo')}:/data/db`,
      '    networks:',
      `      - ${net}`,
      '  redis:',
      '    image: redis:7-alpine',
      '    restart: unless-stopped',
      '    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]',
      '    volumes:',
      `      - ${join(dir, 'redis')}:/data`,
      '    healthcheck:',
      '      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]',
      '      interval: 5s',
      '      timeout: 3s',
      '      retries: 20',
      '    networks:',
      `      - ${net}`,
      'networks:',
      `  ${net}:`,
      '    driver: bridge',
      '',
    ].join('\n');
    const path = this.composePath(tenant.id);
    await fs.writeFile(path, content, 'utf8');
    return path;
  }

  private nginxConf(host: string): string {
    return `events {}
http {
  upstream csbot_adapter { server adapter:3000; }
  server {
    listen 443 ssl;
    server_name ${host};
    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    location / {
      proxy_pass http://csbot_adapter;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
  # 租户 FastGPT 后台（初始化/知识运营），独立端口，FastGPT 自身登录保护
  server {
    listen 8443 ssl;
    server_name ${host};
    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    location / {
      proxy_pass http://fastgpt:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
}
`;
  }

  /** 复制数据面迁移到 tenant initdb（控制面镜像用 /app/migrate，开发环境扫描 src） */
  private async writeInitDb(initDir: string): Promise<void> {
    const files: { name: string; content: string }[] = [];
    const roots = existsSync('/app/migrate')
      ? ['/app/migrate']
      : ['miss', 'media', 'license', 'import'].map((d) => join(process.cwd(), 'src', d));
    for (const root of roots) {
      try {
        for (const f of readdirSync(root).sort()) {
          if (!/^\d{3}-.*\.sql$/.test(f)) continue;
          files.push({ name: f, content: readFileSync(join(root, f), 'utf8') });
        }
      } catch {
        // 目录不存在则跳过（测试/裁剪镜像）
      }
    }
    for (const [i, f] of files.entries()) {
      await fs.writeFile(join(initDir, `${String(10 + i).padStart(2, '0')}-${f.name}`), f.content, 'utf8');
    }
    await fs.writeFile(
      join(initDir, '00-fastgpt-db.sh'),
      '#!/bin/bash\nset -e\npsql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname=\'fastgpt\'" | grep -q 1 || psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE fastgpt"\n',
      { mode: 0o755 },
    );
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

  async restart(tenant: Tenant): Promise<void> {
    await this.compose(tenant, ['restart', 'adapter']);
  }

  async down(tenant: Tenant, dropVols: boolean): Promise<void> {
    await this.compose(tenant, dropVols ? ['down', '-v'] : ['down']);
  }

  /**
   * 健康探测：轮询 http://<host>:<port>/health 直到返回 healthy 或超时。
   * 探测失败（连接拒绝/非 2xx）不算致命，继续重试直到 timeout。
   */
  async probe(tenant: Tenant, timeoutMs: number): Promise<boolean> {
    const name = ShellProvisioner.projectName(tenant.id);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const out = await this.runCapture(this.dockerBin, [
          'inspect', '--format',
          '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
          name,
        ]);
        const status = out.trim();
        if (status === 'healthy' || status === 'running') return true;
      } catch {
        // 容器还没建好
      }
      await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
    }
    return false;
  }

  /** 执行命令并返回 stdout（用于 inspect 等只读探测） */
  private runCapture(bin: string, argv: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
      child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
      child.on('error', (e: Error) => reject(new ProvisionerError(e.message, null, stderr.slice(-2000))));
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new ProvisionerError(`inspect failed (${code})`, code, stderr.slice(-2000)));
      });
    });
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
      '--env-file',
      join(this.tenantDir(tenant.id), 'tenant.env'),
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
