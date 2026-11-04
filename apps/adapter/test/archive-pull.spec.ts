import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ArchiveService } from '../src/archive/archive.service.js';
import { WecomSessionArchiveClient } from '../src/archive/wecom-session-archive.client.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('archive pull', () => {
  beforeEach(() =>
    setConfig({
      WECOM_ARCHIVE_ENABLED: true,
      WECOM_ARCHIVE_PULL_URL: 'https://archive.example/pull',
      WECOM_ARCHIVE_CALLBACK_SECRET: 'sec',
      DATABASE_URL: 'postgres://x',
    }),
  );
  afterEach(() => resetConfig());

  it('disabled → ARCHIVE_PULL_DISABLED', async () => {
    setConfig({ WECOM_ARCHIVE_ENABLED: false });
    const svc = new ArchiveService(
      { createFromFile: jest.fn() } as any,
      { query: jest.fn(), end: jest.fn() } as any,
      undefined,
      new WecomSessionArchiveClient(),
    );
    expect(await svc.pullOnce()).toEqual({ errCode: 'ARCHIVE_PULL_DISABLED' });
  });

  it('pull 入队并推进 cursor；重复 msgId 复用', async () => {
    const createFromFile = jest.fn(async () => ({
      job: { id: 'job-1' },
      reused: false,
    }));
    const client = {
      enabled: () => true,
      pull: jest.fn(async () => ({
        messages: [
          { msgId: 'm1', chatId: 'c', from: 'u', content: 'hi', msgTime: 1 },
          { msgId: 'm2', chatId: 'c', from: 'u', content: 'yo', msgTime: 2 },
        ],
        nextCursor: 'cur-2',
      })),
      verifyCallbackSignature: () => true,
    };
    const svc = new ArchiveService(
      { createFromFile } as any,
      { query: jest.fn(), end: jest.fn() } as any,
      undefined,
      client as any,
    );
    const first = await svc.pullOnce();
    expect(first.jobId).toBe('job-1');
    expect(first.count).toBe(2);
    expect(svc.pullState().cursor).toBe('cur-2');

    client.pull.mockResolvedValueOnce({
      messages: [{ msgId: 'm1', chatId: 'c', from: 'u', content: 'hi', msgTime: 1 }],
      nextCursor: 'cur-3',
    });
    const second = await svc.pullOnce();
    expect(second.reused).toBe(true);
  });

  it('callback 验签失败', async () => {
    const client = new WecomSessionArchiveClient();
    const svc = new ArchiveService(
      { createFromFile: jest.fn() } as any,
      { query: jest.fn(), end: jest.fn() } as any,
      undefined,
      client,
    );
    const bad = await svc.ingestCallback([], '{}', 'bad-sig');
    expect(bad).toEqual({ errCode: 'ARCHIVE_CALLBACK_SIGNATURE_INVALID' });
  });
});
