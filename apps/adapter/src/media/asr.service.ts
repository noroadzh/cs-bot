/**
 * ASR：OpenAI-compatible transcription（DashScope / whisper）
 * 视频先抽音轨再转写；失败由调用方写 miss + 引导话术
 */
import { Injectable, Optional } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

export type MediaKind = 'voice' | 'video';

export interface PreparedAudio {
  buf: Buffer;
  filename: string;
}

/** 可注入：单测替换抽音轨实现 */
export type AudioExtractor = (video: Buffer) => Promise<Buffer>;

@Injectable()
export class AsrService {
  private readonly logger = new AppLogger('AsrService');
  private readonly extractAudio: AudioExtractor;

  constructor(@Optional() extractAudio?: AudioExtractor) {
    this.extractAudio = extractAudio ?? ((buf) => this.ffmpegExtract(buf));
  }

  enabled(): boolean {
    const cfg = ConfigService.instance;
    return Boolean(cfg.ASR_BASE_URL && cfg.ASR_API_KEY);
  }

  maxBytes(kind: MediaKind): number {
    const cfg = ConfigService.instance;
    return kind === 'video'
      ? cfg.MAX_VIDEO_BYTES ?? 100 * 1024 * 1024
      : cfg.MAX_VOICE_BYTES ?? 20 * 1024 * 1024;
  }

  assertWithinLimit(buf: Buffer, kind: MediaKind): void {
    const max = this.maxBytes(kind);
    if (buf.length > max) {
      throw new Error(`media too large: ${buf.length} > ${max}`);
    }
  }

  /** 语音直接转写；视频先抽音轨 */
  async prepareForAsr(buf: Buffer, kind: MediaKind): Promise<PreparedAudio> {
    this.assertWithinLimit(buf, kind);
    if (kind !== 'video') {
      return { buf, filename: 'audio.amr' };
    }
    const audio = await this.extractAudio(buf);
    if (!audio.length) throw new Error('video audio extract empty');
    return { buf: audio, filename: 'audio.wav' };
  }

  async transcribe(buf: Buffer, filename = 'audio.amr'): Promise<string> {
    const cfg = ConfigService.instance;
    if (!this.enabled()) throw new Error('ASR not configured');
    const form = new FormData();
    form.append('file', buf, { filename });
    form.append('model', cfg.ASR_MODEL || 'whisper-1');
    const res = await axios.post(
      `${String(cfg.ASR_BASE_URL).replace(/\/+$/, '')}/audio/transcriptions`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${cfg.ASR_API_KEY}`,
        },
        timeout: cfg.ASR_TIMEOUT_MS ?? 60_000,
        maxBodyLength: Infinity,
      },
    );
    const text = String(res.data?.text ?? res.data?.data?.text ?? '').trim();
    if (!text) throw new Error('ASR empty transcript');
    this.logger.log({ detail: 'asr-ok', bytes: buf.length });
    return text;
  }

  /** 下载 → 限额 →（视频抽轨）→ ASR */
  async transcribeMedia(buf: Buffer, kind: MediaKind): Promise<string> {
    const prepared = await this.prepareForAsr(buf, kind);
    return this.transcribe(prepared.buf, prepared.filename);
  }

  /**
   * 从视频抽取 JPEG 关键帧（ffmpeg）。count=0 或失败返回空数组。
   * 调用方可用 VL 识别后作为 ASR 失败兜底。
   */
  async extractKeyframes(video: Buffer, count?: number): Promise<Buffer[]> {
    const n = count ?? ConfigService.instance.VIDEO_KEYFRAME_COUNT ?? 0;
    if (n <= 0) return [];
    this.assertWithinLimit(video, 'video');
    const id = randomUUID();
    const dir = join(tmpdir(), `csbot-kf-${id}`);
    const inPath = join(dir, 'in.bin');
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.writeFile(inPath, video);
      const frames: Buffer[] = [];
      for (let i = 0; i < n; i++) {
        const outPath = join(dir, `f${i}.jpg`);
        const ss = i === 0 ? '0' : String(Math.min(i, 30));
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            'ffmpeg',
            ['-y', '-ss', ss, '-i', inPath, '-frames:v', '1', '-q:v', '2', outPath],
            { stdio: ['ignore', 'ignore', 'pipe'] },
          );
          let err = '';
          child.stderr?.on('data', (chunk: Buffer) => {
            err += chunk.toString();
          });
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('video keyframe extract timeout'));
          }, ConfigService.instance.VIDEO_KEYFRAME_EXTRACT_TIMEOUT_MS ?? 30_000);
          child.on('error', (e) => {
            clearTimeout(timer);
            reject(new Error(`ffmpeg unavailable: ${e.message}`));
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg keyframe exit ${code}: ${err.slice(-200)}`));
          });
        });
        frames.push(await fs.readFile(outPath));
      }
      this.logger.log({ detail: 'keyframe-ok', count: frames.length });
      return frames;
    } catch (err) {
      this.logger.warn({ detail: 'keyframe-fail', err: (err as Error).message });
      return [];
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async ffmpegExtract(video: Buffer): Promise<Buffer> {
    const id = randomUUID();
    const dir = join(tmpdir(), `csbot-asr-${id}`);
    const inPath = join(dir, 'in.bin');
    const outPath = join(dir, 'out.wav');
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.writeFile(inPath, video);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'ffmpeg',
          ['-y', '-i', inPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', outPath],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let err = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          err += chunk.toString();
        });
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('video audio extract timeout'));
        }, ConfigService.instance.ASR_TIMEOUT_MS ?? 60_000);
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(new Error(`ffmpeg unavailable: ${e.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`));
        });
      });
      return await fs.readFile(outPath);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
