import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consoleFile, resolveConsoleDir } from '../../src/console/mount-console.js';

describe('mount console', () => {
  const prev = process.env.ADMIN_CONSOLE_DIR;

  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_CONSOLE_DIR;
    else process.env.ADMIN_CONSOLE_DIR = prev;
  });

  it('skips a missing directory', () => {
    delete process.env.ADMIN_CONSOLE_DIR;
    expect(resolveConsoleDir(join(tmpdir(), 'csbot-console-missing'))).toBeNull();
  });

  it('serves index for a client route and rejects traversal', () => {
    const root = mkdtempSync(join(tmpdir(), 'csbot-console-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'index.html'), '<html></html>');
    process.env.ADMIN_CONSOLE_DIR = root;
    expect(resolveConsoleDir('/unused')).toBe(root);
    expect(consoleFile(root, '/import/abc')).toBe(join(root, 'index.html'));
    expect(consoleFile(root, '/../../etc/passwd')).toBeNull();
  });
});
