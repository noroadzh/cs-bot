/** 控制面自助 API（无 Basic Auth） */
export class SelfServeError extends Error {
  errCode?: string;
  constructor(message: string, errCode?: string) {
    super(message);
    this.errCode = errCode;
  }
}

async function selfServe<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers });
  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('json')
    ? ((await res.json()) as { errCode?: string; detail?: string; message?: string })
    : undefined;
  if (!res.ok) {
    throw new SelfServeError(
      body?.detail || body?.message || res.statusText || '请求失败',
      body?.errCode,
    );
  }
  return body as T;
}

export type SelfServeOrder = {
  id: string;
  tenantId: string;
  days: number;
  amountCents: number;
  channel: 'mock' | 'wechat' | 'alipay';
  status: 'created' | 'paid' | 'failed';
  prepay?: { provider: string; payload: Record<string, string> };
};

export function registerTenant(input: {
  name: string;
  email: string;
  plan?: string;
}): Promise<{ tenantId: string; status: string; email: string }> {
  return selfServe('/self-serve/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createBillingOrder(input: {
  tenantId: string;
  days: number;
  amountCents: number;
  channel?: 'mock' | 'wechat' | 'alipay';
}): Promise<SelfServeOrder> {
  return selfServe('/self-serve/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getBillingOrder(id: string): Promise<SelfServeOrder> {
  return selfServe(`/self-serve/orders/${encodeURIComponent(id)}`);
}

export function mockPayOrder(id: string): Promise<SelfServeOrder> {
  return selfServe(`/self-serve/orders/${encodeURIComponent(id)}/pay`, { method: 'POST' });
}
