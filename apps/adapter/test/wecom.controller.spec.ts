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
import { describe, it, expect, beforeEach, beforeAll, afterAll, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

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

function makeController(crypto: any, routing: any, gateCheck?: jest.Mock, opsAlert?: any) {
  const { WecomController, LICENSE_INVALID_TEXT, LICENSE_CHAT_LIMIT_TEXT } = require('../src/wecom/wecom.controller.js');
  const usageService = { increment: jest.fn(), snapshot: jest.fn() };
  const recognizeService = { recognizeImage: jest.fn() };
  const activeSend = jest.fn(async (..._args: any[]) => undefined);
  const wecomClient = {
    sendText: jest.fn((...args: any[]) => activeSend(...args)),
    sendMedia: jest.fn(),
    downloadMedia: jest.fn(),
  };
  const licenseGate = { check: gateCheck ?? jest.fn(async () => ({ allowed: true })) };
  const miss = { record: jest.fn(async () => undefined) };
  const alert = opsAlert ?? { alert: jest.fn(async () => true) };
  const controller = new WecomController(crypto, routing, usageService, recognizeService, wecomClient, licenseGate, miss, alert);
  // 暴露给用例断言埋点/下载调用；不改变控制器自身行为
  Object.assign(controller as any, { __usage: usageService, __recognize: recognizeService, __client: wecomClient, __activeSend: activeSend, __gate: licenseGate, __miss: miss, __alert: alert, __imageQueue: (controller as any).imageQueue });
  return { controller, wecomClient, alert, LICENSE_INVALID_TEXT, LICENSE_CHAT_LIMIT_TEXT };
}

beforeAll(() => setConfig({ REQUIRE_GROUP_CHAT_ID: false }));
afterAll(() => resetConfig());

describe('WecomController.callback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('URL 验证（echostr）', () => {
    it('echostr 存在 + 解密成功 → 200 + send(明文)', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve('echo-plain')) });
      const { controller } = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce, echostr: 'echo-cipher' }, {}, {} as any, res);

      expect(res.statusCode).toBe(200);
      expect(res.send).toHaveBeenCalledWith('echo-plain');
      expect(crypto.parseXml).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('echostr 存在 + 解密失败 → 401 + WECOM_SIGN_INVALID', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve(null)) });
      const { controller } = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce, echostr: 'echo-cipher' }, {}, {} as any, res);

      expect(res.statusCode).toBe(401);
      expect(res.json).toHaveBeenCalledWith({ errCode: expect.any(Number) });
      expect(res.send).not.toHaveBeenCalled();
    });

    it('验签/解密失败同时推送一次运维告警（不改变 401）', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve(null)) });
      const { controller, alert } = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce, echostr: 'echo-cipher' }, {}, {} as any, res);
      await new Promise((r) => setTimeout(r, 0));

      expect(res.statusCode).toBe(401);
      expect(alert.alert).toHaveBeenCalledWith('wecom-signature', expect.stringContaining('验签失败'));
    });
  });

  describe('消息回调', () => {
    it('body 是 string → 直接作为密文解密', async () => {
      const crypto = makeCrypto();
      const { controller } = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'raw-cipher', {} as any, res);

      expect(crypto.decryptMsg).toHaveBeenCalledWith('sig-abc', '1700000000', 'nonce-xyz', 'raw-cipher');
      expect(res.statusCode).toBe(200);
      expect(res.send).toHaveBeenCalledWith('');
    });

    it('body 是对象且有 Encrypt → 取 Encrypt 字段', async () => {
      const crypto = makeCrypto();
      const { controller } = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, { Encrypt: 'obj-cipher' }, {} as any, res);

      expect(crypto.decryptMsg).toHaveBeenCalledWith('sig-abc', '1700000000', 'nonce-xyz', 'obj-cipher');
      expect(res.statusCode).toBe(200);
    });

    it('body 是对象但无 Encrypt → 退化为空串（仍走解密）', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve(null)) });
      const { controller } = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, { Other: 'x' }, {} as any, res);

      expect(crypto.decryptMsg).toHaveBeenCalledWith('sig-abc', '1700000000', 'nonce-xyz', '');
      expect(res.statusCode).toBe(401);
    });

    it('解密失败 → 401 + WECOM_SIGN_INVALID', async () => {
      const crypto = makeCrypto({ decryptMsg: jest.fn(() => Promise.resolve(null)) });
      const { controller } = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'bad-cipher', {} as any, res);

      expect(res.statusCode).toBe(401);
      expect(res.json).toHaveBeenCalledWith({ errCode: expect.any(Number) });
      expect(crypto.parseXml).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    it('parseXml 返回 null → 400 + WECOM_DECRYPT_FAIL', async () => {
      const crypto = makeCrypto({ parseXml: jest.fn(() => Promise.resolve(null)) });
      const { controller } = makeController(crypto, makeRouting());

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);

      expect(res.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith({ errCode: expect.any(Number) });
      const routing = makeRouting();
      void routing;
    });

    it('parseXml 成功 → 200 + send(\'\') + dispatch（异步不阻塞响应）', async () => {
      const crypto = makeCrypto();
      const routing = makeRouting();
      const { controller } = makeController(crypto, routing);

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);

      expect(res.statusCode).toBe(200);
      expect(res.send).toHaveBeenCalledWith('');
      expect(routing.dispatch).toHaveBeenCalledTimes(1);
      expect(routing.dispatch).toHaveBeenCalledWith({ MsgType: 'text', Content: 'hi' }, expect.any(String));
    });

    it('dispatch 抛错 → 被 .catch 吞掉（不向企微返回 5xx）', async () => {
      const crypto = makeCrypto();
      const routing = makeRouting(jest.fn<any>(() => Promise.reject(new Error('dispatch boom'))));
      const { controller } = makeController(crypto, routing);

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);

      expect(res.statusCode).toBe(200);
      expect(res.send).toHaveBeenCalledWith('');
    });

    it('dispatch 收到的 traceId 是字符串（来自 Node crypto.randomUUID）', async () => {
      const crypto = makeCrypto();
      const routing = makeRouting();
      const { controller } = makeController(crypto, routing);

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);

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
      const { controller } = makeController(crypto, routing);

      const res = makeRes();
      controller.__client.downloadMedia.mockResolvedValue(Buffer.from('fake-jpeg'));
      controller.__recognize.recognizeImage.mockResolvedValue('a cat sitting on a bench');

      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);
      await controller.__imageQueue.onIdle();

      expect(controller.__client.downloadMedia).toHaveBeenCalledWith('media-123');
      expect(controller.__recognize.recognizeImage).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg');
      expect(controller.__usage.increment).toHaveBeenCalledWith('messagesReceived');
      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesReceived');
      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesRecognized');
    });

    it('image message acked before download/recognition completes', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'media-slow', Content: '', ChatId: 'chat-s' })),
      });
      const { controller } = makeController(crypto, makeRouting());
      const res = makeRes();
      let release!: (b: Buffer) => void;
      controller.__client.downloadMedia.mockImplementation(() => new Promise((r) => { release = r; }));
      controller.__recognize.recognizeImage.mockResolvedValue('如何退款？');

      const pending = controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);
      await pending;
      expect(res.send).toHaveBeenCalled();
      release(Buffer.from([0xff, 0xd8, 0xff, 0x00]));
      await controller.__imageQueue.onIdle();
      expect(controller.__recognize.recognizeImage).toHaveBeenCalled();
    });

    it('image recognize returns null → 跳过 routing，回复引导话术 + imagesSkipped', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'media-456', Content: '', ChatId: 'chat-1' })),
      });
      const routing = makeRouting();
      const { controller } = makeController(crypto, routing);

      const res = makeRes();
      controller.__client.downloadMedia.mockResolvedValue(Buffer.from('fake-jpeg'));
      controller.__recognize.recognizeImage.mockResolvedValue(null);

      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);
      await controller.__imageQueue.onIdle();

      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesSkipped');
      expect(routing.dispatch).not.toHaveBeenCalled(); // PRD FR-9 规则 2: 跳过 routing
      expect(controller.__client.sendText).toHaveBeenCalledWith('chat-1', '抱歉，暂时没看懂这张图片，麻烦用文字简述一下您的问题～');
    });

    it('PNG 图片按真实 MIME 传给识别器', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'media-png', Content: '', ChatId: 'chat-png' })),
      });
      const { controller } = makeController(crypto, makeRouting());
      const res = makeRes();
      controller.__client.downloadMedia.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      controller.__recognize.recognizeImage.mockResolvedValue('如何退款？');
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);
      await controller.__imageQueue.onIdle();
      expect(controller.__recognize.recognizeImage).toHaveBeenCalledWith(expect.any(Buffer), 'image/png');
    });

    it('image recognize returns [NO_TEXT] → 引导话术，不进 routing', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'media-no', Content: '', ChatId: 'chat-no' })),
      });
      const routing = makeRouting();
      const { controller } = makeController(crypto, routing);
      const res = makeRes();
      controller.__client.downloadMedia.mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
      controller.__recognize.recognizeImage.mockResolvedValue('[NO_TEXT]');
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);
      await controller.__imageQueue.onIdle();
      expect(routing.dispatch).not.toHaveBeenCalled();
      expect(controller.__client.sendText).toHaveBeenCalledWith('chat-no', '抱歉，暂时没看懂这张图片，麻烦用文字简述一下您的问题～');
    });

    it('image download throws → 跳过 routing，回复引导话术 + imagesSkipped', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'media-789', Content: '', ChatId: 'chat-2' })),
      });
      const routing = makeRouting();
      const { controller } = makeController(crypto, routing);

      const res = makeRes();
      controller.__client.downloadMedia.mockRejectedValue(new Error('network error'));

      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);
      await controller.__imageQueue.onIdle();

      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesSkipped');
      expect(routing.dispatch).not.toHaveBeenCalled(); // PRD FR-9 规则 2: 跳过 routing
      expect(controller.__client.sendText).toHaveBeenCalledWith('chat-2', '抱歉，暂时没看懂这张图片，麻烦用文字简述一下您的问题～');
    });

    it('normal text message → no image counter calls', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'text', Content: 'hello' })),
      });
      const routing = makeRouting();
      const { controller } = makeController(crypto, routing);

      const res = makeRes();
      await controller.callback({ msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce }, 'cipher', {} as any, res);

      expect(controller.__usage.increment).toHaveBeenCalledWith('messagesReceived');
      const imageCalls = (controller.__usage.increment as any).mock.calls.filter((c: any[]) => c[0].startsWith('image'));
      expect(imageCalls.length).toBe(0);
    });
  });

  describe('ChatId 强校验', () => {
    it('缺少 ChatId → 丢弃、计数、不 dispatch', async () => {
      setConfig({ REQUIRE_GROUP_CHAT_ID: true });
      try {
        const crypto = makeCrypto({
          parseXml: jest.fn(() => Promise.resolve({ MsgType: 'text', Content: 'hi', MsgId: 'm-no-chat', mentioned: true })),
        });
        const routing = makeRouting();
        const { controller } = makeController(crypto, routing);
        const res = makeRes();
        await controller.callback(
          { msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce },
          'cipher', {} as any, res,
        );
        expect(routing.dispatch).not.toHaveBeenCalled();
        expect(controller.__usage.increment).toHaveBeenCalledWith('messagesDroppedNoChatId');
        expect(res.statusCode).toBe(200);
      } finally {
        setConfig({ REQUIRE_GROUP_CHAT_ID: false });
      }
    });
  });

  describe('traceId 与图片大小', () => {
    it('消息 traceId 使用 MsgId', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'text', Content: 'hi', MsgId: 'msg-abc', ChatId: 'c1', mentioned: true })),
      });
      const routing = makeRouting();
      const { controller } = makeController(crypto, routing);
      await controller.callback(
        { msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce },
        'cipher', {} as any, makeRes(),
      );
      expect(routing.dispatch).toHaveBeenCalledWith(expect.objectContaining({ MsgId: 'msg-abc' }), 'msg-abc');
    });

    it('图片超过 10MB → 引导话术，不调用识别', async () => {
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'image', MediaId: 'm-big', Content: '', ChatId: 'c-big' })),
      });
      const { controller } = makeController(crypto, makeRouting());
      controller.__client.downloadMedia.mockResolvedValue(Buffer.alloc(10 * 1024 * 1024 + 1));
      const res = makeRes();
      await controller.callback(
        { msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce },
        'cipher', {} as any, res,
      );
      expect(controller.__recognize.recognizeImage).not.toHaveBeenCalled();
      expect(controller.__client.sendText).toHaveBeenCalledWith('c-big', expect.stringContaining('没看懂'));
      expect(controller.__usage.increment).toHaveBeenCalledWith('imagesSkipped');
      expect(res.statusCode).toBe(200);
    });
  });

  describe('语音/视频/文件入站', () => {
    const call = async (parseMsg: any, opts: { sendReject?: boolean; gate?: any } = {}) => {
      const crypto = makeCrypto({ parseXml: jest.fn(() => Promise.resolve(parseMsg)) });
      const routing = makeRouting();
      const { controller } = makeController(crypto, routing, opts.gate);
      if (opts.sendReject) controller.__client.sendText.mockRejectedValueOnce(new Error('wecom down'));
      const res = makeRes();
      await controller.callback(
        { msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce },
        'cipher', {} as any, res,
      );
      return { controller, routing, res };
    };

    it('@机器人 voice → 引导话术 + miss(mediaType=voice)，不进 routing', async () => {
      const { controller, routing, res } = await call({
        MsgType: 'voice', mentioned: true, ChatId: 'chat-v', FromUserName: 'u-v',
      });
      expect(res.statusCode).toBe(200);
      expect(controller.__miss.record).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'voice', chatId: 'chat-v' }));
      expect(controller.__client.sendText).toHaveBeenCalledWith('chat-v', expect.stringContaining('无法直接查看'));
      expect(routing.dispatch).not.toHaveBeenCalled();
    });

    it('@机器人 file → miss(mediaType=file)', async () => {
      const { controller } = await call({
        MsgType: 'file', mentioned: true, ChatId: 'chat-f', FromUserName: 'u-f',
      });
      expect(controller.__miss.record).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'file' }));
    });

    it('引导话术发送失败仍 ack 200', async () => {
      const { res } = await call(
        { MsgType: 'video', mentioned: true, ChatId: 'chat-x', FromUserName: 'u-x' },
        { sendReject: true },
      );
      expect(res.statusCode).toBe(200);
    });

    it('无 chatId → 不发送但仍 200', async () => {
      const { controller, res } = await call({ MsgType: 'voice', mentioned: true });
      expect(controller.__client.sendText).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });
  });

  describe('租户只读闸门', () => {
    it('tenant-readonly → 回复只读话术，不进 routing', async () => {
      const crypto = makeCrypto({ parseXml: jest.fn(() => Promise.resolve({ MsgType: 'text', Content: 'hi', ChatId: 'c1' })) });
      const routing = makeRouting();
      const gate = jest.fn(async () => ({ allowed: false, reason: 'tenant-readonly' }));
      const { controller } = makeController(crypto, routing, gate);
      const res = makeRes();
      await controller.callback(
        { msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce },
        'cipher', {} as any, res,
      );
      expect(controller.__client.sendText).toHaveBeenCalledWith('c1', expect.stringContaining('只读'));
      expect(routing.dispatch).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });
  });

  describe('单聊被动回复', () => {
    const query = { msg_signature: BASE_ARGS.msgSignature, timestamp: BASE_ARGS.timestamp, nonce: BASE_ARGS.nonce };

    it('有 ChatId 时立即空 ack，不等待 dispatch', async () => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      const crypto = makeCrypto({
        parseXml: jest.fn(() => Promise.resolve({ MsgType: 'text', Content: 'hi', ChatId: 'wr-group' })),
      });
      const routing = makeRouting(jest.fn(() => pending));
      const { controller } = makeController(crypto, routing);
      const res = makeRes();
      await controller.callback(query, 'cipher', {} as any, res);
      expect(res.send).toHaveBeenCalledWith('');
      expect(routing.dispatch).toHaveBeenCalledTimes(1);
      release();
      await pending;
    });

    it('窗口内得到文本则回被动 XML，且不主动发送', async () => {
      setConfig({ REQUIRE_GROUP_CHAT_ID: false, PASSIVE_REPLY_MS: 2000 });
      const buildPassiveReply = jest.fn((_from: string, _to: string, content: string) => `<xml>${content}</xml>`);
      const holder: { client?: { sendText: (...a: unknown[]) => Promise<void> } } = {};
      const routing = makeRouting(jest.fn(async () => {
        await holder.client!.sendText('user-1', '窗口内答案');
      }));
      const crypto = makeCrypto({
        buildPassiveReply,
        parseXml: jest.fn(() => Promise.resolve({
          MsgType: 'text', Content: 'hi', FromUserName: 'user-1', ToUserName: 'bot',
        })),
      });
      const { controller } = makeController(crypto, routing);
      holder.client = controller.__client;
      const res = makeRes();
      res.type = jest.fn(() => res);
      await controller.callback(query, 'cipher', {} as any, res);
      expect(buildPassiveReply).toHaveBeenCalledWith('user-1', 'bot', '窗口内答案');
      expect(res.send).toHaveBeenCalledWith('<xml>窗口内答案</xml>');
      expect(controller.__activeSend).not.toHaveBeenCalled();
    });

    it('超时则空 ack，之后的文本走主动发送', async () => {
      setConfig({ REQUIRE_GROUP_CHAT_ID: false, PASSIVE_REPLY_MS: 30 });
      const holder: { client?: { sendText: (...a: unknown[]) => Promise<void> } } = {};
      const routing = makeRouting(jest.fn(() => new Promise<void>((resolve) => {
        setTimeout(() => {
          void holder.client!.sendText('user-1', '超时答案').then(() => resolve());
        }, 80);
      })));
      const crypto = makeCrypto({
        buildPassiveReply: jest.fn(() => '<xml/>'),
        parseXml: jest.fn(() => Promise.resolve({
          MsgType: 'text', Content: 'hi', FromUserName: 'user-1', ToUserName: 'bot',
        })),
      });
      const { controller } = makeController(crypto, routing);
      holder.client = controller.__client;
      const res = makeRes();
      await controller.callback(query, 'cipher', {} as any, res);
      expect(res.send).toHaveBeenCalledWith('');
      await new Promise((r) => setTimeout(r, 120));
      expect(controller.__activeSend).toHaveBeenCalledWith('user-1', '超时答案');
    });
  });
});
