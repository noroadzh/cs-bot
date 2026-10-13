/**
 * AssetSenderService 单元测试
 *
 * 对应 src/media/asset-sender.service.ts 的分支：
 * - asset 有 url → sendAsset(chatId, url, type)
 * - asset 无 url 但有 path → sendAsset(chatId, path, type)
 * - asset 既无 url 也无 path → sendAsset(chatId, id, type)
 * - sender.sendAsset 抛错 → 不向上抛，仅 WARN 日志
 */
import { describe, it, expect, jest } from '@jest/globals';

describe('AssetSenderService', () => {
  it('asset.url 存在 → 透传 url 作为第二个参数', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'a1', type: 'file', url: 'https://x.example.com/file.pdf' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', 'https://x.example.com/file.pdf', 'file');
  });

  it('asset.url 缺省但 path 存在 → 透传 path', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'a1', type: 'file', path: '/var/data/file.pdf' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', '/var/data/file.pdf', 'file');
  });

  it('asset 既无 url 也无 path → 兜底透传 id', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'fallback-id', type: 'link' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', 'fallback-id', 'link');
  });

  it('url 优先于 path 优先于 id（短路的 nullish coalescing 链）', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => undefined);
    const svc = new AssetSenderService({ sendAsset } as any);

    await svc.send('chat-1', { id: 'id-only', type: 'video', path: '/p', url: '/u' });

    expect(sendAsset).toHaveBeenCalledWith('chat-1', '/u', 'video');
  });

  it('sender 抛错 → send 内部 catch 吞掉，不向上抛', async () => {
    const { AssetSenderService } = await import('../src/media/asset-sender.service.js');
    const sendAsset = jest.fn(async (..._args: any[]) => {
      throw new Error('downstream network down');
    });
    const svc = new AssetSenderService({ sendAsset } as any);

    await expect(svc.send('chat-1', { id: 'a1', type: 'file', url: '/u' })).resolves.toBeUndefined();
  });
});