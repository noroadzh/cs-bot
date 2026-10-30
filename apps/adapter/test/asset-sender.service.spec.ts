/**
 * AssetSenderService 单元测试
 *
 * 对应 src/media/asset-sender.service.ts 的分支：
 * - link → 透传 url 与 name
 * - file/video 的相对 url（/assets/<id>.<ext>）→ 映射为 data/assets/ 绝对路径
 * - file/video 已是绝对路径 → 透传
 * - file/video 无 url/path → 兜底 data/assets/<id>
 * - sender.sendAsset 抛错 → 返回 false，不向上抛
 */
import { describe, it, expect, jest } from '@jest/globals';
import { join } from 'node:path';

const ASSET_DIR = join(process.cwd(), 'data', 'assets');

describe('AssetSenderService', () => {
  it('link → 透传 url 与 name，返回 true', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    const ok = await svc.send('chat-1', {
      id: 'a1', type: 'link', url: 'https://x.example.com/file.pdf', name: '使用手册',
    });

    expect(ok).toBe(true);
    expect(sendAsset).toHaveBeenCalledWith('chat-1', 'https://x.example.com/file.pdf', 'link', '使用手册');
  });

  it('file 的相对 url → 映射为 data/assets 绝对路径', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'a1', type: 'file', url: '/assets/a1.pdf', name: '报价单' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', join(ASSET_DIR, 'a1.pdf'), 'file', '报价单');
  });

  it('video 的相对 url 同样映射（basename 阻断 ../ 逃逸）', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'v1', type: 'video', url: '/assets/../../etc/passwd' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', join(ASSET_DIR, 'passwd'), 'video', undefined);
  });

  it('file 已是绝对路径 → 透传', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'a1', type: 'file', path: '/var/data/file.pdf' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', '/var/data/file.pdf', 'file', undefined);
  });

  it('file 无 url 也无 path → 兜底 data/assets/<id>', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'fallback-id', type: 'file' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', join(ASSET_DIR, 'fallback-id'), 'file', undefined);
  });

  it('link 无 url → 兜底透传 id', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'fallback-id', type: 'link' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', 'fallback-id', 'link', undefined);
  });

  it('url 优先于 path', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'id-only', type: 'video', path: '/p', url: '/u' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', '/u', 'video', undefined);
  });

  it('sender 抛错 → 返回 false，不向上抛', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => {
      throw new Error('downstream network down');
    });
    const svc = new AssetSenderService({ sendAsset } as any);

    await expect(svc.send('chat-1', { id: 'a1', type: 'file', url: '/u' })).resolves.toBe(false);
  });
});
