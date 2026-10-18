/**
 * MediaRecognizeService 单元测试
 *
 * 覆盖服务层分支（parseMimeType 见 media-recognize.service.spec.ts）：
 *   - mock 模式：空 buffer / 不支持的 MIME / 正常返回 mock 描述
 *   - 真实模式：Qwen-VL 调用成功 / 返回非 string / 调用抛错
 *   - recognizeImageFromUrl：空 url / 下载失败 / content-type 缺失回落 /
 *     不支持的 MIME 跳过 / 正常识别
 * axios 全 mock，不发起真实 HTTP。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const axiosPost = jest.fn() as jest.MockedFunction<(...args: any[]) => Promise<any>>;
const axiosInstanceGet = jest.fn() as jest.MockedFunction<(...args: any[]) => Promise<any>>;
const axiosCreate = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: (...args: any[]) => axiosCreate(...args),
    get: (...args: any[]) => axiosInstanceGet(...args),
    post: (...args: any[]) => axiosPost(...args),
  },
}));

import { MediaRecognizeService } from '../src/media/media-recognize.service.js';

describe('MediaRecognizeService', () => {
  beforeAll(() => setConfig());
  afterAll(() => resetConfig());
  beforeEach(() => {
    axiosPost.mockReset();
    axiosInstanceGet.mockReset();
    axiosCreate.mockReset();
    // 默认 mock 模式（USE_MOCK_LLM=true，QWEN_VL_* 未配置）
    setConfig();
  });

  describe('mock 模式（USE_MOCK_LLM=true）', () => {
    it('构造时不创建 axios 实例', () => {
      new MediaRecognizeService({} as any);
      expect(axiosCreate).not.toHaveBeenCalled();
    });

    it('空 buffer → 空串，不调引擎', async () => {
      const svc = new MediaRecognizeService({} as any);
      expect(await svc.recognizeImage(Buffer.alloc(0))).toBe('');
      expect(axiosPost).not.toHaveBeenCalled();
    });

    it('不支持的 MIME → 空串（skip 日志）', async () => {
      const svc = new MediaRecognizeService({} as any);
      expect(await svc.recognizeImage(Buffer.from('x'), 'application/pdf')).toBe('');
    });

    it('支持的 MIME → 返回 mock 描述文案', async () => {
      const svc = new MediaRecognizeService({} as any);
      const text = await svc.recognizeImage(Buffer.from('img'), 'image/png');
      expect(text).toContain('image/png');
      expect(text).toContain('mock');
    });

    it('isSupportedMediaType 白名单', () => {
      const svc = new MediaRecognizeService({} as any);
      expect(svc.isSupportedMediaType('image/webp')).toBe(true);
      expect(svc.isSupportedMediaType('video/mp4')).toBe(false);
    });
  });

  describe('真实模式（Qwen-VL 已配置）', () => {
    beforeEach(() => {
      setConfig({
        USE_MOCK_LLM: false,
        QWEN_VL_BASE_URL: 'https://vl.example.com',
        QWEN_VL_API_KEY: 'qwen-key-123456',
      });
      axiosCreate.mockReturnValue({ post: axiosPost });
    });

    it('构造时以 baseURL / Authorization / timeout 创建 axios 实例', () => {
      new MediaRecognizeService({} as any);
      expect(axiosCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://vl.example.com',
          headers: { Authorization: 'Bearer qwen-key-123456' },
        }),
      );
    });

    it('调用 chat/completions：image_url dataURL + 固定提示词，返回 content', async () => {
      axiosPost.mockResolvedValueOnce({
        data: { choices: [{ message: { content: '图中是一只猫' } }] },
      });

      const svc = new MediaRecognizeService({} as any);
      const text = await svc.recognizeImage(Buffer.from('img-bytes'), 'image/jpeg');

      expect(text).toBe('图中是一只猫');
      const [path, body] = axiosPost.mock.calls[0];
      expect(path).toBe('/v1/chat/completions');
      expect((body as any).model).toBe('qwen-vl-plus');
      const imageUrl = (body as any).messages[0].content[0].image_url.url as string;
      expect(imageUrl).toBe(
        `data:image/jpeg;base64,${Buffer.from('img-bytes').toString('base64')}`,
      );
    });

    it('content 非 string → 空串', async () => {
      axiosPost.mockResolvedValueOnce({
        data: { choices: [{ message: { content: { odd: 1 } } }] },
      });
      const svc = new MediaRecognizeService({} as any);
      expect(await svc.recognizeImage(Buffer.from('x'))).toBe('');
    });

    it('调用抛错 → 空串不向上抛', async () => {
      axiosPost.mockRejectedValueOnce(new Error('upstream 500'));
      const svc = new MediaRecognizeService({} as any);
      expect(await svc.recognizeImage(Buffer.from('x'))).toBe('');
    });
  });

  describe('recognizeImageFromUrl', () => {
    it('空 url → 空串，不发请求', async () => {
      const svc = new MediaRecognizeService({} as any);
      expect(await svc.recognizeImageFromUrl('')).toBe('');
      expect(axiosInstanceGet).not.toHaveBeenCalled();
    });

    it('下载失败 → 空串不抛', async () => {
      axiosInstanceGet.mockRejectedValueOnce(new Error('ENOTFOUND'));
      const svc = new MediaRecognizeService({} as any);
      expect(await svc.recognizeImageFromUrl('https://img.example.com/a.png')).toBe('');
    });

    it('content-type 缺失 → 回落 image/jpeg 识别', async () => {
      axiosInstanceGet.mockResolvedValueOnce({
        data: Buffer.from('bytes'),
        headers: {},
      });
      const svc = new MediaRecognizeService({} as any);
      const text = await svc.recognizeImageFromUrl('https://img.example.com/a');
      expect(text).toContain('image/jpeg');
    });

    it('content-type 不在白名单 → 识别返回空串', async () => {
      axiosInstanceGet.mockResolvedValueOnce({
        data: Buffer.from('bytes'),
        headers: { 'content-type': 'application/pdf' },
      });
      const svc = new MediaRecognizeService({} as any);
      expect(await svc.recognizeImageFromUrl('https://img.example.com/a.pdf')).toBe('');
    });

    it('content-type image/png + mock 模式 → 返回 png 描述', async () => {
      axiosInstanceGet.mockResolvedValueOnce({
        data: Buffer.from('png-bytes'),
        headers: { 'content-type': 'image/png; charset=binary' },
      });
      const svc = new MediaRecognizeService({} as any);
      const text = await svc.recognizeImageFromUrl('https://img.example.com/a.png');
      expect(text).toContain('image/png');
      expect(axiosInstanceGet).toHaveBeenCalledWith(
        'https://img.example.com/a.png',
        expect.objectContaining({ responseType: 'arraybuffer' }),
      );
    });
  });
});
