import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AsrService } from '../src/media/asr.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('AsrService media matrix', () => {
  beforeEach(() => {
    setConfig({
      ASR_BASE_URL: 'https://asr.example',
      ASR_API_KEY: 'k',
      MAX_VIDEO_BYTES: 1024,
      MAX_VOICE_BYTES: 512,
      ASR_TIMEOUT_MS: 5000,
    });
  });
  afterEach(() => resetConfig());

  it('视频超限抛错（供调用方写 miss）', async () => {
    const svc = new AsrService(async () => Buffer.from('audio'));
    await expect(svc.prepareForAsr(Buffer.alloc(2048), 'video')).rejects.toThrow(/media too large/);
  });

  it('视频先抽音轨再得到 wav 缓冲', async () => {
    const extract = jest.fn(async () => Buffer.from('wav-bytes'));
    const svc = new AsrService(extract);
    const prepared = await svc.prepareForAsr(Buffer.from('mp4'), 'video');
    expect(extract).toHaveBeenCalled();
    expect(prepared.filename).toBe('audio.wav');
    expect(prepared.buf.toString()).toBe('wav-bytes');
  });

  it('抽音轨失败向上抛出', async () => {
    const svc = new AsrService(async () => {
      throw new Error('ffmpeg unavailable');
    });
    await expect(svc.prepareForAsr(Buffer.from('mp4'), 'video')).rejects.toThrow(/ffmpeg unavailable/);
  });

  it('语音不抽轨直接 amr 文件名', async () => {
    const extract = jest.fn(async () => Buffer.from('x'));
    const svc = new AsrService(extract);
    const prepared = await svc.prepareForAsr(Buffer.from('amr'), 'voice');
    expect(extract).not.toHaveBeenCalled();
    expect(prepared.filename).toBe('audio.amr');
  });
});
