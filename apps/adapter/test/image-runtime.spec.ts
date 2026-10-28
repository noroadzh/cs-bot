/**
 * 运行时镜像非 root / 可写 / UID 覆盖
 * 需要本地存在镜像且 docker 可用；否则跳过。
 */
import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';

const IMAGE = process.env.VERIFY_IMAGE ?? 'cs-bot-adapter:verify';
const env = { ...process.env };

let hasImage = false;
try {
  execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore', env });
  hasImage = true;
} catch {
  hasImage = false;
}

const itIf = hasImage ? it : it.skip;

const run = (args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8', env }).trim();

describe('runtime image', () => {
  itIf('runs as non-root and can write data/logs/license', () => {
    const out = run([
      'run', '--rm', '--entrypoint', '/nodejs/bin/node', IMAGE, '-e',
      "const fs=require('fs');for(const d of ['/app/data','/app/logs','/app/license']){fs.writeFileSync(d+'/.probe','ok');fs.unlinkSync(d+'/.probe')}console.log(process.getuid())",
    ]);
    expect(out).toBe('65532');
  });

  itIf('honours an explicit UID override', () => {
    const out = run([
      'run', '--rm', '--user', '1500:1500', '--entrypoint', '/nodejs/bin/node', IMAGE, '-e',
      'console.log(process.getuid())',
    ]);
    expect(out).toBe('1500');
  });
});
