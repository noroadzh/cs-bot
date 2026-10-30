/**
 * 验收：1 万条历史会话导入 ≤10 分钟（解析 + 配对）
 * 报告写入 artifacts/acceptance/import-throughput-*.json，断言失败前也会落盘。
 * 未设置 TEST_PG_URL 时跳过。
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Pool } from 'pg';
import { promises as fs } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImportJobService } from '../../src/import/import-job.service.js';
import { SensitiveRedactor } from '../../src/import/sensitive-redactor.js';
import { InMemoryDatasetClient } from '../../src/import/fastgpt-dataset.client.js';
import { NoopSearchClient } from '../../src/import/near-duplicate.js';
import { applyMigrations } from '../__setup__/migrations.js';
import { setConfig } from '../__setup__/inject-config.js';
import { resetConfig } from '../__setup__/test-helpers.js';

jest.setTimeout(660_000);
const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;
const MESSAGE_COUNT = 10_000;
const TARGET_MS = 10 * 60_000;

suite('验收：导入吞吐', () => {
  let pool: Pool;
  let svc: ImportJobService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);
    setConfig({
      DATABASE_URL: PG_URL,
      IMPORT_RULES_FILE: '',
      IMPORT_BLACKLIST_FILE: '',
      IMPORT_MAX_MESSAGES: 100_000,
      IMPORT_MEMORY_LIMIT_MB: 4096,
      LOG_LEVEL: 'silent',
    });
    svc = new ImportJobService({} as any, new SensitiveRedactor());
    svc.setDatasetClient(new InMemoryDatasetClient());
    svc.setSearchClient(new NoopSearchClient());
  });

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    resetConfig();
  });

  it('1 万条消息 ≤10 分钟完成解析与配对', async () => {
    const runId = Date.now();
    const messages = Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
      sender: i % 2 === 0 ? '客户张三' : '客服小李',
      content:
        i % 2 === 0
          ? `[${runId}] 第 ${i} 条客户问题，想咨询退款流程与到账时间`
          : `[${runId}] 第 ${i} 条客服回复，退款一般 1-3 个工作日到账，请在订单页申请`,
      time: i * 1000,
    }));
    const bytes = Buffer.from(JSON.stringify(messages), 'utf8');

    const start = Date.now();
    const created = await svc.createFromFile({
      filename: 'throughput.json',
      mimeType: 'application/json',
      bytes,
      name: `throughput-${Date.now()}`,
    });
    const parsed = await svc.parseJob(created.job.id);
    const elapsedMs = Date.now() - start;

    const outDir = join(process.cwd(), '..', '..', 'artifacts', 'acceptance');
    await mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(
      join(outDir, `import-throughput-${stamp}.json`),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          messageCount: MESSAGE_COUNT,
          paired: parsed.pairedCount ?? null,
          unpaired: parsed.unpairedCount ?? null,
          elapsedMs,
          targetMs: TARGET_MS,
          passed: elapsedMs < TARGET_MS,
        },
        null,
        2,
      ),
      'utf8',
    );

    expect(parsed.status).toBe('parsed');
    expect(elapsedMs).toBeLessThan(TARGET_MS);

    await pool.query('DELETE FROM import_job WHERE id = $1', [created.job.id]);
    await fs.rm(join(process.cwd(), 'data', 'import', created.job.id), { recursive: true, force: true });
  });
});
