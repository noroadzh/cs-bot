import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const post: any = jest.fn(async () => ({ data: { choices: [{ message: { content: '如何退款？' } }] } }));
const create: any = jest.fn(() => ({ post, get: jest.fn() }));
jest.mock('axios', () => ({ __esModule: true, default: { create: (...a: unknown[]) => create(...(a as [])), get: jest.fn() } }));

import { MediaRecognizeService } from '../src/media/media-recognize.service.js';

describe('MediaRecognizeService config', () => {
  beforeEach(() => {
    setConfig({
      USE_MOCK_LLM: false,
      QWEN_VL_BASE_URL: 'https://vl.example/v1',
      QWEN_VL_API_KEY: 'k'.repeat(10),
      QWEN_VL_MODEL: 'qwen-vl-custom',
    });
    post.mockClear();
    create.mockClear();
  });
  afterEach(() => resetConfig());

  it('uses 10s timeout, configured model and question-extraction prompt', async () => {
    const svc = new MediaRecognizeService({} as any);
    const out = await svc.recognizeImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg');
    expect(out).toBe('如何退款？');
    expect((create.mock.calls[0][0] as any).timeout).toBe(10_000);
    const body = (post.mock.calls[0][1] as any);
    expect(body.model).toBe('qwen-vl-custom');
    expect(body.messages[0].content[1].text).toContain('提取图片中与咨询/操作相关的文字');
    expect(body.messages[0].content[1].text).toContain('[NO_TEXT]');
  });
});
