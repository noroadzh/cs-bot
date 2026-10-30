/**
 * 部署运行时：adapter 必须挂载 data/logs/license 且可写
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const compose = readFileSync(join(ROOT, 'deploy', 'docker-compose.yml'), 'utf8');
const dockerfile = readFileSync(join(ROOT, 'deploy', 'Dockerfile.adapter'), 'utf8');

describe('adapter runtime mounts', () => {
  it('compose 挂载 data/logs/license', () => {
    expect(compose).toContain('../data:/app/data');
    expect(compose).toContain('../logs:/app/logs');
    expect(compose).toContain('../license:/app/license:ro');
  });

  it('日志落盘路径指向挂载目录', () => {
    expect(compose).toContain('LOG_FILE: /app/logs/adapter.log');
  });

  it('镜像创建运行期目录并归属 nonroot', () => {
    expect(dockerfile).toContain('mkdir -p /app/data /app/logs /app/license');
    expect(dockerfile).toContain('--chown=65532:65532 /app/data /app/data');
  });

  it('默认以非 root 运行且可由 CSBOT_UID/GID 覆盖', () => {
    expect(compose).toContain('user: "${CSBOT_UID:-65532}:${CSBOT_GID:-65532}"');
    expect(compose).not.toContain('${CSBOT_UID:-0}');
  });

  it('FastGPT 管理后台经 nginx 8443 反代且默认拒绝', () => {
    const nginxConf = readFileSync(join(ROOT, 'deploy', 'nginx', 'nginx.conf'), 'utf8');
    expect(nginxConf).toContain('listen 8443 ssl');
    expect(nginxConf).toContain('include /etc/nginx/fastgpt-admin-allow.conf');
    expect(nginxConf).toContain('proxy_pass http://fastgpt:3000');

    const allow = readFileSync(join(ROOT, 'deploy', 'nginx', 'fastgpt-admin-allow.conf'), 'utf8');
    expect(allow).toContain('deny all;');
    expect(allow).not.toContain('allow ');

    expect(compose).toContain('${FASTGPT_ADMIN_PORT:-8443}:8443');
    expect(compose).toContain('./nginx/fastgpt-admin-allow.conf:/etc/nginx/fastgpt-admin-allow.conf:ro');
  });

  it('提供一键部署脚本（预检/启动/健康等待）', () => {
    const install = readFileSync(join(ROOT, 'deploy', 'install.sh'), 'utf8');
    expect(install).toContain('docker compose -f "$COMPOSE"');
    expect(install).toContain('up -d');
    expect(install).toContain('--check');
    expect(install).toContain('--dry-run');
    expect(install).toContain('/healthz');
    expect(install).not.toContain('docker-compose.saas.yml up');
  });

  it('每个服务都有内存限额且总和不超过 6.5G，Redis 配 maxmemory', () => {
    const limits = [...compose.matchAll(/mem_limit:\s*(\d+)m/g)].map((m) => Number(m[1]));
    expect(limits).toHaveLength(6);
    expect(limits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6500);
    expect(compose).toContain('--maxmemory 384mb');
    expect(compose).toContain('--maxmemory-policy allkeys-lru');
  });

  it('SaaS 叠加文件为控制面加了内存限额', () => {
    const saas = readFileSync(join(ROOT, 'deploy', 'docker-compose.saas.yml'), 'utf8');
    expect(saas).toMatch(/control-plane:\n(?:.*\n)*?\s+mem_limit: \d+m/);
  });

  it('提供宿主目录权限校正脚本', () => {
    const script = readFileSync(join(ROOT, 'deploy', 'init-perms.sh'), 'utf8');
    expect(script).toContain('CSBOT_UID:-65532');
    expect(script).toContain('chown -R');
  });

  it('控制面拆分到 SaaS 叠加文件，基线仅 6 服务', () => {
    expect(compose).not.toContain('  control-plane:');
    expect(compose).toContain('CONTROL_PLANE_URL: ${CONTROL_PLANE_URL:-}');
    expect(compose).toContain('init-control-db.sh');
    const saas = readFileSync(join(ROOT, 'deploy', 'docker-compose.saas.yml'), 'utf8');
    expect(saas).toContain('control-plane:');
    expect(saas).toContain('command: ["apps/adapter/dist/control-plane-main.js"]');
    expect(saas).toContain('csbot_control');
    expect(saas).toContain('CONTROL_PLANE_URL: http://control-plane:3100');
    expect(dockerfile).toContain('COPY --from=builder /app/scripts /app/scripts');
  });

  it('基线不携带签发工具与宿主 docker socket，仅 SaaS 叠加文件使用', () => {
    expect(compose).not.toContain('tools/license-issuer');
    expect(compose).not.toContain('/var/run/docker.sock');
    const saas = readFileSync(join(ROOT, 'deploy', 'docker-compose.saas.yml'), 'utf8');
    expect(saas).toContain('../tools/license-issuer:/app/tools/license-issuer:ro');
    expect(saas).toContain('/var/run/docker.sock:/var/run/docker.sock');
  });

  it('控制面默认不发布公网端口，提供显式 override', () => {
    expect(compose).not.toContain('3100:3100');
    const override = readFileSync(join(ROOT, 'deploy', 'docker-compose.control-plane-expose.yml'), 'utf8');
    expect(override).toContain('CONTROL_PLANE_BIND');
    expect(override).toContain('3100:3100');
  });

  it('每日备份包含控制面库', () => {
    const backup = readFileSync(join(ROOT, 'deploy', 'backup.sh'), 'utf8');
    expect(backup).toContain('pg_control_');
    expect(backup).toContain('CONTROL_PLANE_DB');
  });
});
