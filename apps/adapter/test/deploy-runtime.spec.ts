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

  it('adapter 用户可由 CSBOT_UID/GID 覆盖', () => {
    expect(compose).toContain('user: "${CSBOT_UID:-0}:${CSBOT_GID:-0}"');
  });
});
