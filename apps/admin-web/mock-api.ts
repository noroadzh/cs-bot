import type { Connect, Plugin } from 'vite';

const basic = `Basic ${Buffer.from('ops:secret').toString('base64')}`;

export function mockApiPlugin(): Plugin {
  return {
    name: 'admin-console-mock',
    configureServer(server) {
      if (process.env.VITE_MOCK !== '1') return;
      const tenants = [{ id: 't1', name: '示例租户', status: 'created', plan: 'standard', contact: 'ops@example.com' }];
      server.middlewares.use(handler(tenants));
    },
  };
}

function handler(tenants: { id: string; name: string; status: string; plan: string; contact: string }[]): Connect.NextHandleFunction {
  const orders = new Map<string, { id: string; tenantId: string; days: number; amountCents: number; channel: string; status: string }>();
  return (req, res, next) => {
    const url = req.url ?? '';
    const path = url.split('?')[0];
    if (url.startsWith('/self-serve')) {
      if (req.method === 'POST' && path === '/self-serve/register') {
        readJson(req, (body) => {
          const row = {
            id: `t${tenants.length + 1}`,
            name: String(body.name ?? ''),
            status: 'trialing',
            plan: String(body.plan ?? 'standard'),
            contact: String(body.email ?? ''),
          };
          tenants.push(row);
          send(res, 201, { tenantId: row.id, status: row.status, email: row.contact, verified: false });
        });
        return;
      }
      if (req.method === 'POST' && path === '/self-serve/orders') {
        readJson(req, (body) => {
          const id = `ord-${orders.size + 1}`;
          const order = {
            id,
            tenantId: String(body.tenantId ?? ''),
            days: Number(body.days ?? 30),
            amountCents: Number(body.amountCents ?? 9900),
            channel: 'mock',
            status: 'created',
          };
          orders.set(id, order);
          send(res, 201, order);
        });
        return;
      }
      const payMatch = path.match(/^\/self-serve\/orders\/([^/]+)\/pay$/);
      if (req.method === 'POST' && payMatch) {
        const order = orders.get(payMatch[1]);
        if (!order) {
          send(res, 404, { errCode: 'ORDER_NOT_FOUND' });
          return;
        }
        order.status = 'paid';
        send(res, 200, order);
        return;
      }
      const getMatch = path.match(/^\/self-serve\/orders\/([^/]+)$/);
      if (req.method === 'GET' && getMatch) {
        const order = orders.get(getMatch[1]);
        if (!order) {
          send(res, 404, { errCode: 'ORDER_NOT_FOUND' });
          return;
        }
        send(res, 200, order);
        return;
      }
      next();
      return;
    }
    if (!url.startsWith('/admin') && !url.startsWith('/platform')) {
      next();
      return;
    }
    if (req.headers.authorization !== basic) {
      send(res, 401, { errCode: 'UNAUTHORIZED', detail: '未授权' });
      return;
    }
    if (req.method === 'GET' && path === '/admin/miss-records' && url.includes('format=xlsx')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.end('xlsx');
      return;
    }
    if (req.method === 'GET' && path === '/admin/miss-records') {
      send(res, 200, {
        total: 1,
        items: [{
          question: '怎么退款',
          chatId: 'chat-1',
          score: 0.2,
          mediaType: 'text',
          status: 'open',
          createdAt: '2026-10-30T00:00:00.000Z',
          userId: 'u***',
        }],
      });
      return;
    }
    if (req.method === 'GET' && path === '/admin/config-check') {
      send(res, 200, { mode: {}, config: { ADMIN_USER: { present: true } } });
      return;
    }
    if (req.method === 'GET' && path === '/admin/license') {
      send(res, 200, { valid: true, reason: 'ok', mock: true, fingerprint: 'fp', daysLeft: 30, maxChats: 5, currentUsage: { messagesReceived: 1, assetsSent: 0 } });
      return;
    }
    if (req.method === 'POST' && path === '/admin/keywords/reload') {
      send(res, 201, { reloaded: true, count: 3 });
      return;
    }
    if (req.method === 'POST' && path === '/admin/config/reload') {
      send(res, 500, { errCode: 'RELOAD_FAILED', detail: '词典文件缺失' });
      return;
    }
    if (req.method === 'GET' && path === '/platform/tenants') {
      send(res, 200, { total: tenants.length, limit: 50, offset: 0, rows: tenants });
      return;
    }
    if (req.method === 'POST' && path === '/platform/tenants') {
      readJson(req, (body) => {
        if (!body.reason) {
          send(res, 400, { errCode: 'PLATFORM_REASON_REQUIRED', detail: 'reason is required' });
          return;
        }
        const row = { id: `t${tenants.length + 1}`, name: String(body.name ?? ''), status: 'created', plan: String(body.plan ?? 'standard'), contact: String(body.contact ?? '') };
        tenants.push(row);
        send(res, 201, row);
      });
      return;
    }
    if (req.method === 'POST' && path === '/platform/tenants/missing/provision') {
      send(res, 404, { errCode: 'TENANT_NOT_FOUND', detail: '租户不存在' });
      return;
    }
    next();
  };
}

function send(res: import('http').ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJson(req: import('http').IncomingMessage, done: (body: Record<string, unknown>) => void): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    try {
      done(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>);
    } catch {
      done({});
    }
  });
}
