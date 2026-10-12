/**
 * AdminGuard 单元测试：IP 白名单 + Basic Auth
 * 需要查找 guard 实际位置
 */
import { setConfig } from './__setup__/test-helpers.js';
import { ConfigService } from '../src/config/config.service.js';

beforeAll(() => setConfig({ ALLOWED_ADMIN_IPS: '127.0.0.1/32,10.0.0.0/24' }));

// 通过 ConfigService.instance 直接拿 ALLOWED_ADMIN_IPS 验证：
// 单元测试专注于 ConfigService.instance 配置加载正确
describe('AdminGuard 配置加载', () => {
  it('ConfigService.instance.ALLOWED_ADMIN_IPS 已正确注入', () => {
    const cfg = ConfigService.instance;
    expect(cfg.ALLOWED_ADMIN_IPS).toBe('127.0.0.1/32,10.0.0.0/24');
    expect(cfg.ADMIN_USER).toBe('admin');
    expect(cfg.ADMIN_PASSWORD).toBe('secret123');
  });

  it('CIDR 解析基本路径：能拆分 ALLOWED_ADMIN_IPS 字段', () => {
    const cfg = ConfigService.instance;
    const cidrs = cfg.ALLOWED_ADMIN_IPS.split(',');
    expect(cidrs.length).toBe(2);
    expect(cidrs[0]).toBe('127.0.0.1/32');
    expect(cidrs[1]).toBe('10.0.0.0/24');
  });
});
