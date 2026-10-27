/**
 * WecomClient 单元测试
 * 覆盖：sendText / sendFile / sendVideo / uploadMedia 正常路径
 *       + access_token 内存缓存 / Redis 缓存 / API 刷新 / 锁竞争重试
 *
 * 策略：jest.mock('axios') 拦截 axios.create 返回可控实例；
 *       WecomClient 构造函数内部自行 new Redis()，由 ioredis mock 兜底。
 */
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import { setConfig } from './__setup__/test-helpers.js';

const apiMock = {
  get: jest.fn<(...a: any[]) => Promise<any>>(),
  post: jest.fn<(...a: any[]) => Promise<any>>(),
};

const redisMock = {
  get: jest.fn<(...a: any[]) => Promise<any>>(),
  set: jest.fn<(...a: any[]) => Promise<any>>(),
  del: jest.fn<(...a: any[]) => Promise<any>>(),
  ttl: jest.fn<(...a: any[]) => Promise<any>>(),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('axios', () => ({
  create: jest.fn(() => apiMock),
  default: { create: jest.fn(() => apiMock) },
}));

jest.mock('ioredis', () => ({
  Redis: jest.fn(() => redisMock),
}));

beforeAll(() => {
  setConfig({
    WECHAT_CORP_ID: 'ww1234567890abcdef',
    WECHAT_AGENT_SECRET: 'test_secret_abcdefgh',
  });
});

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  redisMock.get.mockReset();
  redisMock.set.mockReset();
  redisMock.del.mockReset();
  redisMock.ttl.mockReset();

  // 默认：Redis 无缓存 → 走 API 刷新
  redisMock.get.mockResolvedValue(null);
  redisMock.ttl.mockResolvedValue(-1);
  redisMock.set.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
  apiMock.get.mockResolvedValue({ data: { errcode: 0, access_token: 'api-token', expires_in: 7000 } });
  apiMock.post.mockResolvedValue({ data: { errcode: 0 } });
});

const newClient = async (): Promise<any> => {
  const { WecomClient } = await import('../src/wecom/wecom-client.js');
  return new (WecomClient as any)({});
};

/** 预置 token 缓存，跳过 getAccessToken 的网络路径 */
const withToken = (client: any): any => {
  client.tokenCache = { token: 'tok', expireAt: Date.now() + 3600_000 };
  return client;
};

describe('WecomClient', () => {
  describe('getAccessToken', () => {
    it('3.4.a 内存缓存命中：直接返回，不查 Redis 也不调 API', async () => {
      const client = await newClient();
      withToken(client);
      await expect(client.getAccessToken()).resolves.toBe('tok');
      expect(redisMock.get).not.toHaveBeenCalled();
      expect(apiMock.get).not.toHaveBeenCalled();
    });

    it('3.4.b 内存未命中但 Redis 有值且 TTL>0 → 写内存缓存并返回', async () => {
      redisMock.get.mockResolvedValueOnce('redis-token');
      redisMock.ttl.mockResolvedValueOnce(7000);

      const client = await newClient();
      await expect(client.getAccessToken()).resolves.toBe('redis-token');
      expect(redisMock.get).toHaveBeenCalledWith('wecom:at');
      expect(redisMock.ttl).toHaveBeenCalledWith('wecom:at');
      expect(client.tokenCache.token).toBe('redis-token');
      expect(apiMock.get).not.toHaveBeenCalled();
    });

    it('3.4.c Redis 无缓存：调 /gettoken 拿 token 并 SETEX 回 Redis', async () => {
      const client = await newClient();
      await expect(client.getAccessToken()).resolves.toBe('api-token');

      expect(apiMock.get).toHaveBeenCalledWith('/gettoken', expect.objectContaining({ params: expect.any(Object) }));
      expect(redisMock.set).toHaveBeenCalledWith('wecom:at', 'api-token', 'EX', 7000);
      expect(redisMock.del).toHaveBeenCalledWith('wecom:at:lock');
    });

    it('3.4.d API 返回 errcode≠0：抛错并释放锁', async () => {
      apiMock.get.mockResolvedValueOnce({ data: { errcode: 40001, errmsg: 'invalid secret' } });
      const client = await newClient();

      await expect(client.getAccessToken()).rejects.toThrow('invalid secret');
      expect(redisMock.del).toHaveBeenCalledWith('wecom:at:lock');
    });

    it('3.4.e 锁未抢到且重试拿到 Redis token：直接返回该 token', async () => {
      // 第 1 次 get → null；抢锁失败；等待 2s 后第 2 次 get → 有值
      redisMock.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('winner-token');
      redisMock.ttl.mockResolvedValueOnce(-1);
      redisMock.set.mockResolvedValueOnce(null); // lock 抢不到

      const client = await newClient();
      const token = await client.getAccessToken();

      expect(token).toBe('winner-token');
      expect(apiMock.get).not.toHaveBeenCalled();
      jest.useRealTimers();
    }, 10_000);
  });

  describe('sendText', () => {
    it('3.4.f sendText 正常路径：POST /appchat/send msgtype=text', async () => {
      const client = withToken(await newClient());
      await expect(client.sendText('chat-001', 'hello world')).resolves.toBeUndefined();

      expect(apiMock.post).toHaveBeenCalledWith(
        '/appchat/send',
        expect.objectContaining({ chatid: 'chat-001', msgtype: 'text', text: { content: 'hello world' } }),
        expect.objectContaining({ params: { access_token: 'tok' } }),
      );
    });

    it('3.4.g sendText 带 atUser：body 含 atuserlist', async () => {
      const client = withToken(await newClient());
      await client.sendText('chat-001', 'hello', 'user-B');

      expect(apiMock.post).toHaveBeenCalledWith(
        '/appchat/send',
        expect.objectContaining({ atuserlist: 'user-B' }),
        expect.anything(),
      );
    });

    it('3.4.h sendText errcode≠0：抛错并带 code=WECOM_SEND_FAIL', async () => {
      apiMock.post.mockResolvedValueOnce({ data: { errcode: 40008, errmsg: 'invalid chatid' } });
      const client = withToken(await newClient());

      await expect(client.sendText('bad-chat', 'hi')).rejects.toThrow('invalid chatid');
    });
  });

  describe('sendFile / sendVideo', () => {
    it('3.4.i sendFile：POST /appchat/send msgtype=file', async () => {
      const client = withToken(await newClient());
      await client.sendFile('chat-002', 'media-id-123');

      expect(apiMock.post).toHaveBeenCalledWith(
        '/appchat/send',
        expect.objectContaining({ chatid: 'chat-002', msgtype: 'file', file: { media_id: 'media-id-123' } }),
        expect.anything(),
      );
    });

    it('3.4.j sendVideo：POST /appchat/send msgtype=video，含 title/description', async () => {
      const client = withToken(await newClient());
      await client.sendVideo('chat-003', 'video-media-id', '视频标题');

      expect(apiMock.post).toHaveBeenCalledWith(
        '/appchat/send',
        expect.objectContaining({
          chatid: 'chat-003',
          msgtype: 'video',
          video: { media_id: 'video-media-id', title: '视频标题', description: '视频标题' },
        }),
        expect.anything(),
      );
    });
  });

  describe('sendFile/sendVideo 错误分支', () => {
    it('sendFile errcode≠0 → WECOM_SEND_FAIL', async () => {
      const client = withToken(await newClient());
      apiMock.post.mockResolvedValueOnce({ data: { errcode: 40008, errmsg: 'bad file' } });
      await expect(client.sendFile('chat-1', 'mid')).rejects.toMatchObject({ code: 10003 });
    });

    it('sendVideo errcode≠0 → WECOM_SEND_FAIL', async () => {
      const client = withToken(await newClient());
      apiMock.post.mockResolvedValueOnce({ data: { errcode: 40008, errmsg: 'bad video' } });
      await expect(client.sendVideo('chat-1', 'mid', 't')).rejects.toMatchObject({ code: 10003 });
    });

    it('uploadMedia errcode≠0 两次 → WECOM_UPLOAD_FAIL', async () => {
      const client = withToken(await newClient());
      apiMock.post.mockResolvedValue({ data: { errcode: 40009, errmsg: 'upload fail' } });
      await expect(client.uploadMedia('file', '/tmp/fake.pdf')).rejects.toMatchObject({ code: 10004 });
    });
  });

  describe('uploadMedia / downloadMedia', () => {
    it('3.4.k uploadMedia：POST /media/upload 返回 media_id', async () => {
      apiMock.post.mockResolvedValueOnce({ data: { errcode: 0, media_id: 'uploaded-media-id' } });
      const client = withToken(await newClient());

      const id = await client.uploadMedia('file', '/tmp/fake.pdf');
      expect(id).toBe('uploaded-media-id');
      expect(apiMock.post).toHaveBeenCalledWith(
        '/media/upload',
        expect.anything(),
        expect.objectContaining({ params: { access_token: 'tok', type: 'file' } }),
      );
    });

    it('3.4.l uploadMedia 首次失败自动重试一次并成功', async () => {
      apiMock.post
        .mockRejectedValueOnce(new Error('network reset'))
        .mockResolvedValueOnce({ data: { errcode: 0, media_id: 'retry-media-id' } });
      const client = withToken(await newClient());

      await expect(client.uploadMedia('image', '/tmp/fake.png')).resolves.toBe('retry-media-id');
      expect(apiMock.post).toHaveBeenCalledTimes(2);
    });

    it('3.4.m downloadMedia：GET /media/get 返回 Buffer', async () => {
      apiMock.get.mockResolvedValueOnce({ data: Buffer.from('binary-data') });
      const client = withToken(await newClient());

      const buf = await client.downloadMedia('media-id-xyz');
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.toString()).toBe('binary-data');
    });
  });

  describe('sendAsset 分发', () => {
    it('3.4.n sendAsset link：直接 sendText', async () => {
      const client = withToken(await newClient());
      await client.sendAsset('chat-004', 'https://example.com/doc', 'link');
      expect(apiMock.post).toHaveBeenCalledWith('/appchat/send', expect.objectContaining({ msgtype: 'text' }), expect.anything());
    });

    it('3.4.o sendAsset file：先 uploadMedia 再 sendFile', async () => {
      apiMock.post.mockResolvedValueOnce({ data: { errcode: 0, media_id: 'uploaded-1' } });
      const client = withToken(await newClient());
      await client.sendAsset('chat-005', '/tmp/doc.pdf', 'file');

      const calls = apiMock.post.mock.calls;
      expect(calls.some((c: any[]) => c[0] === '/media/upload')).toBe(true);
      expect(calls.some((c: any[]) => c[1]?.msgtype === 'file')).toBe(true);
    });
  });
});