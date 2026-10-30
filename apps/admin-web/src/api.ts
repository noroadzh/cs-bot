import { authHeader, clearCredentials } from './auth.js';

export class ApiError extends Error {
  status: number;
  errCode?: string;

  constructor(status: number, message: string, errCode?: string) {
    super(message);
    this.status = status;
    this.errCode = errCode;
  }
}

export function requireReason(reason: string | undefined | null): string {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ApiError(0, '请填写原因');
  return trimmed;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const auth = authHeader();
  if (auth) headers.set('Authorization', auth);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    clearCredentials();
    window.dispatchEvent(new Event('csbot-unauthorized'));
    throw new ApiError(401, '未授权');
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let detail = res.statusText || '请求失败';
    let errCode: string | undefined;
    if (contentType.includes('json')) {
      const body = (await res.json()) as { errCode?: string; detail?: string; message?: string };
      errCode = body.errCode;
      detail = body.detail || body.message || detail;
    }
    throw new ApiError(res.status, String(detail), errCode);
  }
  if (contentType.includes('spreadsheet') || contentType.includes('octet-stream')) {
    return (await res.blob()) as T;
  }
  if (!contentType.includes('json')) return undefined as T;
  return (await res.json()) as T;
}
