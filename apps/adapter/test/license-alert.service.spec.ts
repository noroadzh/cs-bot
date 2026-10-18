/**
 * LicenseAlertService 单元测试
 *
 * URL 未配置 → 不发、返回 false；正常 → POST 企微 text 格式；
 * 5xx / 网络错误 → warn 不抛、返回 false。
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const fetchMock = jest.fn<() => Promise<Response>>();

describe('LicenseAlertService.sendAlert', () => {
  let LicenseAlertService: typeof import('../src/license/license-alert.service.js').LicenseAlertService;

  beforeAll(async () => {
    ({ LicenseAlertService } = await import('../src/license/license-alert.service.js'));
  });

  beforeEach(() => {
    resetConfig();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    resetConfig();
    jest.restoreAllMocks();
  });

  it('OPS_WEBHOOK_URL 为空 → 不发请求，返回 false', async () => {
    setConfig({ OPS_WEBHOOK_URL: '' });
    const svc = new LicenseAlertService();
    const sent = await svc.sendAlert('测试');
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('配置了 URL → POST 企微 text 格式，带 [cs-bot] 前缀，返回 true', async () => {
    setConfig({ OPS_WEBHOOK_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k' });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errcode: 0 }), { status: 200 }));
    const svc = new LicenseAlertService();
    const sent = await svc.sendAlert('license 7 天后到期');
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k');
    const body = JSON.parse(String(init.body)) as { msgtype: string; text: { content: string } };
    expect(body.msgtype).toBe('text');
    expect(body.text.content).toBe('[cs-bot] license 7 天后到期');
  });

  it('HTTP 500 → warn 不抛，返回 false', async () => {
    setConfig({ OPS_WEBHOOK_URL: 'https://ops.example.com/hook' });
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const svc = new LicenseAlertService();
    const sent = await svc.sendAlert('x');
    expect(sent).toBe(false);
  });

  it('网络异常 → warn 不抛，返回 false', async () => {
    setConfig({ OPS_WEBHOOK_URL: 'https://ops.example.com/hook' });
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = new LicenseAlertService();
    const sent = await svc.sendAlert('x');
    expect(sent).toBe(false);
  });
});
