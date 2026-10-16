/**
 * WecomController 单元测试（wecom.controller.ts，分支覆盖率 0% → 目标 100%）
 *
 * 覆盖 src/wecom/wecom.controller.ts 的 6 条分支：
 * 1. echostr !== undefined 且解密成功 → 200 + send(decrypt)
 * 2. echostr !== undefined 且解密失败 → 401 + WECOM_SIGN_INVALID
 * 3. echostr undefined + body 是 string → 取 body 作为密文
 * 4. echostr undefined + body 是对象且有 Encrypt → 取 body.Encrypt
 * 5. 解密失败 → 401；parseXml 返回 null → 400 + WECOM_DECRYPT_FAIL
 * 6. parseXml 成功 → 200 + send('') + 后台 dispatch（不 await）
 * 7. dispatch 抛错 → 被 .catch 吞掉，只写 error 日志
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/** 记录 res 调用序列的 mock */
function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
    send: jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
  };
  return res;
}

const BASE_ARGS = {
  msgSignature: 'sig-abc',
  timestamp: '1700000000',
  nonce: 'nonce-xyz',
};

function makeCrypto(overrides: Record<string, any> = {}) {
  const decryptMsg = jest.fn<any>(() => Promise.resolve('decrypted-plaintext'));
  const parseXml = jest.fn<any>(() => Promise.resolve({ MsgType: 'text', Content: 'hi' }));
  return {
    randomUUID: jest.fn(() => 'trace-uuid-1'),
    decryptMsg,
    parseXml,
    ...overrides,
  } as any;
}

function makeRouting(dispatchImpl?: (...a: any[]) => any) {
  const dispatch = dispatchImpl ?? jest.fn<any>(() => Promise.resolve());
  return { dispatch } as any;
}

function makeController(crypto: any, routing: any) {
  const { WecomController } = require('../src/wecom/wecom.controller.js');
  const usageService = { increment: jest.fn(), snapshot: jest.fn() };
  const recognizeService = { recognizeImage: jest.fn() };
  const wecomClient = { sendText: jest.fn(), sendMedia: jest.fn(), downloadMedia: jest.fn() };
  const controller = new WecomController(crypto, routing, usageService, recognizeService, wecomClient);
  // 暴露给用例断言埋点/下载调用；不改变控制器自身行为
  Object.assign(controller as any, { __usage: usageService, __recognize: recognizeService, __client: wecomClient });
  return controller;
}

describe('WecomController.callback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('URL 验证（echostr）', () => {
    it('echostr 存在 + 解密成功 → 200 + send(明文)', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve('echo-plain')) });
      const controller = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, 'echo-cipher', {}, {} as any, res);

      expect(res.statusCode).toBe(200);
      expect(res.send).toHaveBeenCalledWith('echo-plain');
      expect(crypto.parseXml).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('echostr 存在 + 解密失败 → 401 + WECOM_SIGN_INVALID', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve(null)) });
      const controller = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, 'echo-cipher', {}, {} as any, res);

      expect(res.statusCode).toBe(401);
      expect(res.json).toHaveBeenCalledWith({ errCode: expect.any(Number) });
      expect(res.send).not.toHaveBeenCalled();
    });
  });

  describe('消息回调', () => {
    it('body 是 string → 直接作为密文解密', async () => {
      const crypto = makeCrypto();
      const controller = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'raw-cipher', {} as any, res);

      expect(crypto.decryptMsg).toHaveBeenCalledWith('sig-abc', '1700000000', 'nonce-xyz', 'raw-cipher');
      expect(res.statusCode).toBe(200);
      expect(res.send).toHaveBeenCalledWith('');
    });

    it('body 是对象且有 Encrypt → 取 Encrypt 字段', async () => {
      const crypto = makeCrypto();
      const controller = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, { Encrypt: 'obj-cipher' }, {} as any, res);

      expect(crypto.decryptMsg).toHaveBeenCalledWith('sig-abc', '1700000000', 'nonce-xyz', 'obj-cipher');
      expect(res.statusCode).toBe(200);
    });

    it('body 是对象但无 Encrypt → 退化为空串（仍走解密）', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve(null)) });
      const controller = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, { Other: 'x' }, {} as any, res);

      expect(crypto.decryptMsg).toHaveBeenCalledWith('sig-abc', '1700000000', 'nonce-xyz', '');
      expect(res.statusCode).toBe(401);
    });

    it('解密失败 → 401 + WECOM_SIGN_INVALID', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve(null)) });
      const controller = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'bad-cipher', {} as any, res);

      expect(res.statusCode).toBe(401);
      expect(res.json).toHaveBeenCalledWith({ errCode: expect.any(Number) });
      expect(crypto.parseXml).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    it('parseXml 返回 null → 400 + WECOM_DECRYPT_FAIL', async () => {
      const crypto = makeCrypto({ parseXml: jest.fn(() => Promise.resolve(null)) });
      const controller = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'cipher', {} as any, res);

      expect(res.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith({ errCode: expect.any(Number) });
      const routing = makeRouting();
      void routing;
    });

    it('parseXml 成功 → 200 + send(\'\') + dispatch（异步不阻塞响应）', async () => {
      const crypto = makeCrypto();
      const routing = makeRouting();
      const controller = makeController(crypto, routing);

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'cipher', {} as any, res);

      expect(res.statusCode).toBe(200);
      expect(res.send).toHaveBeenCalledWith('');
      expect(routing.dispatch).toHaveBeenCalledTimes(1);
      expect(routing.dispatch).toHaveBeenCalledWith({ MsgType: 'text', Content: 'hi' }, expect.any(String));
    });

    it('dispatch 抛错 → 被 .catch 吞掉（不向企微返回 5xx）', async () => {
      const crypto = makeCrypto();
      const routing = makeRouting(jest.fn<any>(() => Promise.reject(new Error('dispatch boom'))));
      const controller = makeController(crypto, routing);

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'cipher', {} as any, res);

      expect(res.statusCode).toBe(200);
      expect(res.send).toHaveBeenCalledWith('');
    });

    it('dispatch 收到的 traceId 是字符串（来自 Node crypto.randomUUID）', async () => {
      const crypto = makeCrypto();
      const routing = makeRouting();
      const controller = makeController(crypto, routing);

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'cipher', {} as any, res);

      const callArgs = (routing.dispatch as any).mock.calls[0];
      expect(typeof callArgs[1]).toBe('string');
      expect(callArgs[1].length).toBeGreaterThan(0);
    });
  });

  describe('Image handling + usage counters', () => {
    it('image message + MediaId → calls downloadMedia + recognizeImage', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'media-123', Content: '' })),
      });
      const routing = makeRouting();
      const controller = makeController(crypto, routing) as any;

      const res = makeRes();
      controller.__client.downloadMedia.mockResolvedValue(Buffer.from('fake-jpeg'));
      controller.__recognize.recognizeImage.mockResolvedValue('a cat sitting on a bench');

      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'cipher', {} as any, res);

      expect(controller.__client.downloadMedia).toHaveBeenCalledWith('media-123');
      expect(controller.__recognize.recognizeImage).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg');
      expect(controller.__usage.increment).toHaveBeenCalledWith('messagesReceived');
      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesReceived');
      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesRecognized');
    });

    it('image recognize returns null → Content = [图片消息] + imagesSkipped', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'media-456', Content: '' })),
      });
      const routing = makeRouting();
      const controller = makeController(crypto, routing) as any;

      const res = makeRes();
      controller.__client.downloadMedia.mockResolvedValue(Buffer.from('fake-jpeg'));
      controller.__recognize.recognizeImage.mockResolvedValue(null);

      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'cipher', {} as any, res);

      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesSkipped');
    });

    it('image download throws → Content = [图片消息] + imagesSkipped (不阻塞 routing)', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'media-789', Content: '' })),
      });
      const routing = makeRouting();
      const controller = makeController(crypto, routing) as any;

      const res = makeRes();
      controller.__client.downloadMedia.mockRejectedValue(new Error('network error'));

      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'cipher', {} as any, res);

      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesSkipped');
      expect(routing.dispatch).toHaveBeenCalled(); // routing 不阻塞
    });

    it('normal text message → no image counter calls', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'text', Content: 'hello' })),
      });
      const routing = makeRouting();
      const controller = makeController(crypto, routing) as any;

      const res = makeRes();
      await controller.callback(BASE_ARGS.msgSignature, BASE_ARGS.timestamp, BASE_ARGS.nonce, undefined, 'cipher', {} as any, res);

      expect(controller.__usage.increment).toHaveBeenCalledWith('messagesReceived');
      const imageCalls = (controller.__usage.increment as any).mock.calls.filter((c: any[]) => c[0].startsWith('image'));
      expect(imageCalls.length).toBe(0);
    });
  });
});
