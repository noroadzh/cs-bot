import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { INestApplication } from '@nestjs/common';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

type HttpApp = {
  use: (path: string, handler: (req: ConsoleReq, res: ConsoleRes, next: () => void) => void) => void;
};

type ConsoleReq = { url?: string };
type ConsoleRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: () => void;
};

export function resolveConsoleDir(fallbackDir: string): string | null {
  const configured = process.env.ADMIN_CONSOLE_DIR?.trim();
  const root = configured || fallbackDir;
  return existsSync(root) ? root : null;
}

export function consoleFile(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const rel = decoded.replace(/^\/+/, '');
  const candidate = normalize(join(root, rel || 'index.html'));
  const base = normalize(root);
  if (candidate !== base && !candidate.startsWith(base + sep)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const index = join(base, 'index.html');
  return existsSync(index) ? index : null;
}

export function mountAdminConsole(app: INestApplication, fallbackDir: string): boolean {
  const root = resolveConsoleDir(fallbackDir);
  if (!root) return false;
  const http = app.getHttpAdapter().getInstance() as HttpApp;
  http.use('/console', (req, res, next) => {
    const file = consoleFile(root, req.url ?? '/');
    if (!file) {
      next();
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res as unknown as NodeJS.WritableStream);
  });
  return true;
}
