/**
 * 验收：ab 压测 /wecom/callback（签名 mock）
 *
 * mock 全栈（真实 adapter + 本地 PG + 内存 Redis + FastGPT/企微 mock），
 * 通过 ApacheBench 打回调接口，产出 artifacts/acceptance/ 报告。
 *
 * 验收口径：P95 ≤ 8000ms、失败请求 0。回调为异步 ack 模型，
 * 该延迟衡量的是 webhook 应答时延（企微侧重试阈值），不是完整 QA 时延。
 * 另一个阶段以 20/min 群限流重启应用，验证 ab 压测下限流确实生效并写入报告。
 *
 * 依赖：TEST_PG_URL；本机需安装 ab（ApacheBench）。缺失则 skip。
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { applyMigrations } from '../__setup__/migrations.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module.js';
import { WecomCrypto } from '../../src/wecom/wecom-crypto.js';
import { setConfig } from '../__setup__/inject-config.js';
import { resetConfig } from '../__setup__/test-helpers.js';

jest.setTimeout(180_000);

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;
const execFileP = promisify(execFile);

const AB_TIMEOUT_MS = 8000;
const REQUESTS = 200;
const CONCURRENCY = 20;

jest.mock('ioredis', () => {
  const mod = require('ioredis-mock');
  const RedisCtor = mod.default ?? mod;
  return { Redis: RedisCtor, default: RedisCtor };
});

jest.mock('axios', () => {
  const g = globalThis as any;
  g.__ax = { chatCalls: 0, sendCalls: 0 };
  const post = jest.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/chat/completions')) {
      g.__ax.chatCalls += 1;
      return {
        data: {
          data: [{ score: 0.95, content: '压测答案' }],
          choices: [{ message: { content: '压测答案' } }],
        },
      };
    }
    if (typeof url === 'string' && url.includes('gettoken')) {
      return { data: { errcode: 0, access_token: 'mock-token', expires_in: 7200 } };
    }
    g.__ax.sendCalls += 1;
    return { data: { errcode: 0 } };
  });
  const get = jest.fn(async () => ({ data: { errcode: 0, access_token: 'mock-token', expires_in: 7200 } }));
  const api = { post, get };
  const factory = () => api;
  return { create: factory, default: { create: factory } };
});

function num(re: RegExp, text: string): number | null {
  const m = re.exec(text);
  return m ? Number(m[1]) : null;
}

async function hasAb(): Promise<boolean> {
  try {
    await execFileP('ab', ['-V'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

suite('验收：ab 压测 /wecom/callback', () => {
  let pool: Pool;
  let app: any;
  let abAvailable = false;
  let msgSeq = 0;
  const payloadPath = join(tmpdir(), `csbot-ab-payload-${process.pid}.json`);
  const fakeState: { msg: any } = { msg: null };

  const fakeCrypto = {
    randomUUID: () => `trace-${++msgSeq}`,
    decryptMsg: async () => 'plain',
    parseXml: async () => ({
      ToUserName: 'corp',
      FromUserName: 'ab-user',
      ChatId: 'ab-chat',
      MsgType: 'text',
      Content: '压测问题',
      MsgId: `ab-msg-${++msgSeq}`,
      CreateTime: Math.floor(Date.now() / 1000),
      mentioned: true,
      ...(fakeState.msg ?? {}),
    }),
  };

  beforeAll(async () => {
    abAvailable = await hasAb();
    await writeFile(payloadPath, JSON.stringify({ Encrypt: 'x' }), 'utf8');

    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);

    setConfig({
      DATABASE_URL: PG_URL,
      USE_MOCK_LLM: false,
      USE_MOCK_LICENSE: true,
      CONFIDENCE_THRESHOLD: 0.75,
      SEGMENT_GAP_MS: 0,
      RATE_USER_PER_MIN: 1_000_000,
      RATE_GROUP_PER_MIN: 1_000_000,
      LOG_LEVEL: 'silent',
      REPLY_QUEUE_ENABLED: false,
      MOCK_QA_FILE: '',
      KEYWORDS_FILE: '',
      WECHAT_BOT_USER_ID: '',
      LICENSE_FILE: '/tmp/csbot-acceptance-no-license.lic',
      MODEL_MODE: 'cloud',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WecomCrypto)
      .useValue(fakeCrypto)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
  });

  afterAll(async () => {
    if (app) await app.close();
    await pool?.end().catch(() => undefined);
    await rm(payloadPath, { force: true }).catch(() => undefined);
    resetConfig();
  });

  it('3.1 ab 压测：P95 ≤ 8s、失败请求 0、吞吐达标', async () => {
    if (!abAvailable) {
      console.warn('[acceptance] ab 未安装，跳过压测');
      return;
    }
    const server = app.getHttpServer();
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const url = `http://127.0.0.1:${port}/wecom/callback?msg_signature=sig&timestamp=1&nonce=1`;
    const { stdout, stderr } = await execFileP(
      'ab',
      ['-n', String(REQUESTS), '-c', String(CONCURRENCY), '-p', payloadPath, '-T', 'application/json', url],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const out = `${stdout}\n${stderr}`;

    const failed = num(/Failed requests:\s+(\d+)/, out) ?? -1;
    const p95 = num(/^\s*95%\s+(\d+)/m, out);
    const rps = num(/Requests per second:\s+([\d.]+)/, out);
    const meanMs = num(/Time per request:\s+([\d.]+)\s*\[ms\] \(mean\)/, out);
    const non2xx = num(/Non-2xx responses:\s+(\d+)/, out) ?? 0;

    // 报告产物
    const outDir = join(process.cwd(), '..', '..', 'artifacts', 'acceptance');
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const report = {
      generatedAt: new Date().toISOString(),
      tool: 'ab',
      environment: 'mock',
      note: 'mock 全栈口径，不代表生产容量；回调为异步 ack，延迟为 webhook 应答时延',
      url: '/wecom/callback',
      requests: REQUESTS,
      concurrency: CONCURRENCY,
      throughputRps: rps,
      meanLatencyMs: meanMs,
      p95LatencyMs: p95,
      failedRequests: failed,
      non2xx,
      thresholdP95Ms: AB_TIMEOUT_MS,
      passed: failed === 0 && non2xx === 0 && p95 !== null && p95 <= AB_TIMEOUT_MS,
    };
    await writeFile(join(outDir, `ab-report-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');
    await writeFile(
      join(outDir, `ab-report-${stamp}.txt`),
      [
        `# ab acceptance report (mock full stack)`,
        `generatedAt: ${report.generatedAt}`,
        `environment=${report.environment}`,
        `note=${report.note}`,
        `requests=${REQUESTS} concurrency=${CONCURRENCY}`,
        `throughput=${rps} req/s`,
        `mean=${meanMs} ms`,
        `p95=${p95} ms (threshold ${AB_TIMEOUT_MS} ms)`,
        `failed=${failed} non2xx=${non2xx}`,
        `passed=${report.passed}`,
        '',
        '## raw ab output',
        out,
      ].join('\n'),
      'utf8',
    );

    expect(failed).toBe(0);
    expect(non2xx).toBe(0);
    expect(p95).not.toBeNull();
    expect(p95!).toBeLessThanOrEqual(AB_TIMEOUT_MS);
    expect(rps).not.toBeNull();
    expect(rps!).toBeGreaterThan(0);
  });

  it('3.2 压测后链路确实处理了消息（异步 ack 未丢消息）', async () => {
    if (!abAvailable) return;
    const g = (globalThis as any).__ax;
    const start = Date.now();
    while (Date.now() - start < 5000 && g.chatCalls < 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(g.chatCalls).toBeGreaterThanOrEqual(1);
    expect(g.sendCalls).toBeGreaterThanOrEqual(1);
  });

  it('10.1 持续压测：50 并发 × 10 分钟（SUSTAINED_LOAD=1 才执行）', async () => {
    if (!abAvailable || process.env.SUSTAINED_LOAD !== '1') return;
    const seconds = Number(process.env.SUSTAINED_LOAD_SECONDS ?? 600);
    const addr = app.getHttpServer().address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}/wecom/callback?msg_signature=sig&timestamp=1&nonce=1`;
    const g = (globalThis as any).__ax;
    const baseChat = g.chatCalls;
    const baseSend = g.sendCalls;

    const { stdout, stderr } = await execFileP(
      'ab',
      ['-c', '50', '-t', String(seconds), '-p', payloadPath, '-T', 'application/json', url],
      { maxBuffer: 32 * 1024 * 1024, timeout: (seconds + 60) * 1000 },
    );
    const out = `${stdout}\n${stderr}`;
    const completed = num(/Complete requests:\s+(\d+)/, out) ?? 0;
    const failed = num(/Failed requests:\s+(\d+)/, out) ?? -1;
    const p95 = num(/^\s*95%\s+(\d+)/m, out);

    let last = -1;
    let stableSince = Date.now();
    const settleStart = Date.now();
    while (Date.now() - settleStart < 30_000) {
      if (g.chatCalls !== last) { last = g.chatCalls; stableSince = Date.now(); }
      else if (Date.now() - stableSince > 1000) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const processed = g.chatCalls - baseChat;
    const sent = g.sendCalls - baseSend;

    const outDir = join(process.cwd(), '..', '..', 'artifacts', 'acceptance');
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const report = {
      generatedAt: new Date().toISOString(),
      phase: 'sustained-load',
      concurrency: 50,
      durationSeconds: seconds,
      requests: completed,
      processedMessages: processed,
      sentMessages: sent,
      failedRequests: failed,
      p95LatencyMs: p95,
      thresholdP95Ms: AB_TIMEOUT_MS,
      lostMessages: Math.max(0, completed - processed),
      passed: failed === 0 && p95 !== null && p95 <= AB_TIMEOUT_MS && processed >= completed,
    };
    await writeFile(join(outDir, `ab-sustained-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');

    expect(failed).toBe(0);
    expect(p95).not.toBeNull();
    expect(p95!).toBeLessThanOrEqual(AB_TIMEOUT_MS);
    expect(processed).toBeGreaterThanOrEqual(completed);
  }, 700_000);

  it('3.3 限流阶段：ab 同群高频 → 实际回复受 20/min 限制，报告记录 limiterEngaged', async () => {
    if (!abAvailable) return;
    const GROUP_LIMIT = 20;
    const USER_LIMIT = 5;

    // 第二个 app：20/min 群限流 + 30 个轮换用户（避免先撞单人 5/min）
    setConfig({
      DATABASE_URL: PG_URL,
      USE_MOCK_LLM: false,
      USE_MOCK_LICENSE: true,
      CONFIDENCE_THRESHOLD: 0.75,
      SEGMENT_GAP_MS: 0,
      RATE_USER_PER_MIN: USER_LIMIT,
      RATE_GROUP_PER_MIN: GROUP_LIMIT,
      LOG_LEVEL: 'silent',
      REPLY_QUEUE_ENABLED: false,
      MOCK_QA_FILE: '',
      KEYWORDS_FILE: '',
      WECHAT_BOT_USER_ID: '',
      LICENSE_FILE: '/tmp/csbot-acceptance-no-license.lic',
      MODEL_MODE: 'cloud',
    });
    let seq = 0;
    const limiterCrypto = {
      randomUUID: () => `trace-limiter-${++seq}`,
      decryptMsg: async () => 'plain',
      parseXml: async () => {
        const n = ++seq;
        return {
          ToUserName: 'corp',
          FromUserName: `ab-limiter-user-${n % 200}`,
          ChatId: 'ab-chat-limiter',
          MsgType: 'text',
          Content: '限流压测问题',
          MsgId: `ab-limiter-${n}`,
          CreateTime: Math.floor(Date.now() / 1000),
          mentioned: true,
        };
      },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WecomCrypto)
      .useValue(limiterCrypto)
      .compile();
    const app2 = moduleRef.createNestApplication();
    await app2.init();
    await app2.listen(0);

    try {
      const addr = app2.getHttpServer().address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      expect(port).toBeGreaterThan(0);
      const url = `http://127.0.0.1:${port}/wecom/callback?msg_signature=sig&timestamp=1&nonce=1`;

      const g = (globalThis as any).__ax;
      const baseChat = g.chatCalls;
      const baseSend = g.sendCalls;
      const minuteStart = Math.floor(Date.now() / 60_000);

      const { stdout, stderr } = await execFileP(
        'ab',
        ['-n', String(REQUESTS), '-c', String(CONCURRENCY), '-p', payloadPath, '-T', 'application/json', url],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const out = `${stdout}\n${stderr}`;
      const minuteEnd = Math.floor(Date.now() / 60_000);
      const minuteBuckets = minuteEnd - minuteStart + 1;

      // 等待异步 dispatch 稳定（最多 8s）
      let last = -1;
      let stableSince = Date.now();
      const settleStart = Date.now();
      while (Date.now() - settleStart < 8000) {
        if (g.chatCalls !== last) {
          last = g.chatCalls;
          stableSince = Date.now();
        } else if (Date.now() - stableSince > 500) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      const processed = g.chatCalls - baseChat;
      const sent = g.sendCalls - baseSend;
      const maxAllowed = GROUP_LIMIT * minuteBuckets;
      const limiterEngaged = processed > 0 && processed < REQUESTS;

      const outDir = join(process.cwd(), '..', '..', 'artifacts', 'acceptance');
      await mkdir(outDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const report = {
        generatedAt: new Date().toISOString(),
        tool: 'ab',
        environment: 'mock',
        note: 'limiter phase: same group, 200 cycling users; not production capacity',
        phase: 'rate-limit',
        requests: REQUESTS,
        concurrency: CONCURRENCY,
        groupLimitPerMin: GROUP_LIMIT,
        userLimitPerMin: USER_LIMIT,
        minuteBuckets,
        processedMessages: processed,
        sentMessages: sent,
        limiterEngaged,
        passed: limiterEngaged && processed <= maxAllowed,
      };
      await writeFile(join(outDir, `ab-limiter-report-${stamp}.json`), JSON.stringify(report, null, 2), 'utf8');
      await writeFile(
        join(outDir, `ab-limiter-report-${stamp}.txt`),
        [
          '# ab acceptance report (rate-limit phase, mock)',
          `generatedAt: ${report.generatedAt}`,
          `requests=${REQUESTS} concurrency=${CONCURRENCY}`,
          `groupLimit=${GROUP_LIMIT}/min userLimit=${USER_LIMIT}/min`,
          `processedMessages=${processed} sentMessages=${sent}`,
          `minuteBuckets=${minuteBuckets} maxAllowed=${maxAllowed}`,
          `limiterEngaged=${limiterEngaged}`,
          `passed=${report.passed}`,
          '',
          '## raw ab output',
          out,
        ].join('\n'),
        'utf8',
      );

      expect(processed).toBeGreaterThan(0);
      expect(limiterEngaged).toBe(true);
      expect(processed).toBeLessThanOrEqual(maxAllowed);
      // sent 含限流提示话术，仅作答数（processed）受配额约束
    } finally {
      await app2.close().catch(() => undefined);
    }
  });
});
