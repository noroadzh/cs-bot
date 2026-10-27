/**
 * 问答质量：提问守卫、前缀剥离、来源引用
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { ConfigService } from '../src/config/config.service.js';
import { resetPrefixCache } from '../src/qa/question-normalizer.js';

let dir: string;
let kwFile: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'csbot-qa-q-'));
  kwFile = join(dir, 'keywords.yml');
  await writeFile(kwFile, 'keywords:\n  - "客服："\n', 'utf8');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  resetConfig();
});

beforeEach(() => {
  resetPrefixCache();
  setConfig({
    CONFIDENCE_THRESHOLD: 0.75,
    SEGMENT_SAFE_BYTES: 4000,
    SEGMENT_GAP_MS: 0,
    KEYWORDS_FILE: kwFile,
    QUESTION_GUIDANCE_TEXT: '请描述问题～',
  });
});

const makeSender = () => ({
  sendText: jest.fn(async (..._a: unknown[]) => undefined),
  sendAsset: jest.fn(async (..._a: unknown[]) => undefined),
});
const stubContext = () => ({ get: jest.fn(async () => []), append: jest.fn(async () => undefined) });
const stubFilter = () => ({ sweep: (s: string) => s });
const stubMiss = () => ({ record: jest.fn(async () => undefined) });
const stubAsset = () => ({ send: jest.fn(async () => undefined) });
const stubResolver = () => ({ resolve: jest.fn(async () => null) });
const stubUsage = () => ({ increment: jest.fn() });

async function build(engine: any, sender: any) {
  const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
  return new QaOrchestrator(
    engine, stubContext() as any, stubFilter() as any, stubMiss() as any,
    stubAsset() as any, stubResolver() as any, stubUsage() as any, sender as any,
  );
}

const msg = (text: string): any => ({
  ToUserName: 'corp', ChatId: 'chat-q', FromUserName: 'user-q',
  MsgType: 'text', Content: text, text, mentioned: false,
  CreateTime: Math.floor(Date.now() / 1000),
});

describe('QaOrchestrator 质量守卫', () => {
  it('空问题 → 引导话术，不调用引擎', async () => {
    const engine = { mode: 'mock', ask: jest.fn() };
    const sender = makeSender();
    const orch = await build(engine, sender);
    await orch.handle(msg('   '), 't1', 'mention');
    expect(engine.ask).not.toHaveBeenCalled();
    expect(sender.sendText).toHaveBeenCalledWith('chat-q', '请描述问题～', undefined);
  });

  it('超长问题 → 引导话术，不调用引擎', async () => {
    const engine = { mode: 'mock', ask: jest.fn() };
    const sender = makeSender();
    const orch = await build(engine, sender);
    await orch.handle(msg('问'.repeat(501)), 't2', 'mention');
    expect(engine.ask).not.toHaveBeenCalled();
  });

  it('剥离 @ 与触发词后传给引擎', async () => {
    const engine = { mode: 'mock', ask: jest.fn(async () => ({ ok: true, value: { answer: 'A', quotes: [], score: 0.9 } })) };
    const sender = makeSender();
    const orch = await build(engine, sender);
    await orch.handle(msg('@机器人 客服：怎么开发票'), 't3', 'mention');
    expect(((engine.ask as any).mock.calls[0][0] as any).question).toBe('怎么开发票');
  });

  it('答案追加最多 2 条来源引用', async () => {
    const engine = {
      mode: 'fastgpt',
      ask: jest.fn(async () => ({
        ok: true,
        value: {
          answer: '答案',
          score: 0.9,
          quotes: [
            { id: '1', content: '', score: 0.9, source: '财务制度.pdf' },
            { id: '2', content: '', score: 0.8, source: '报销流程.docx' },
            { id: '3', content: '', score: 0.7, source: '其他.pdf' },
          ],
        },
      })),
    };
    const sender = makeSender();
    const orch = await build(engine, sender);
    await orch.handle(msg('怎么报销'), 't4', 'mention');
    const sent = sender.sendText.mock.calls[0][1] as unknown as string;
    expect(sent).toContain('—— 来源：《财务制度.pdf》');
    expect(sent).toContain('—— 来源：《报销流程.docx》');
    expect(sent).not.toContain('其他.pdf');
  });

  it('引导话术发送失败不抛出', async () => {
    const engine = { mode: 'mock', ask: jest.fn() };
    const sender = { sendText: jest.fn(async () => { throw new Error('wecom down'); }), sendAsset: jest.fn() };
    const orch = await build(engine, sender);
    await expect(orch.handle(msg(''), 't6', 'mention')).resolves.toBeUndefined();
    expect(engine.ask).not.toHaveBeenCalled();
  });

  it('quote 只有 title 时也能生成来源引用', async () => {
    const engine = {
      mode: 'fastgpt',
      ask: jest.fn(async () => ({ ok: true, value: { answer: 'A', score: 0.9, quotes: [{ id: '1', content: '', score: 0.9, title: '手册.pdf' }] } })),
    };
    const sender = makeSender();
    const orch = await build(engine, sender);
    await orch.handle(msg('问题'), 't7', 'mention');
    expect(sender.sendText.mock.calls[0][1]).toContain('—— 来源：《手册.pdf》');
  });

  it('无 quote 时不追加引用', async () => {
    const engine = { mode: 'mock', ask: jest.fn(async () => ({ ok: true, value: { answer: '纯答案', quotes: [], score: 0.9 } })) };
    const sender = makeSender();
    const orch = await build(engine, sender);
    await orch.handle(msg('问题'), 't5', 'mention');
    expect(sender.sendText.mock.calls[0][1]).toBe('纯答案');
  });
});
