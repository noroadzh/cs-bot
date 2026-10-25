/**
 * M10 重管线端到端（真实 PG + InMemoryDatasetClient）
 *
 * 需要 TEST_PG_URL；未设置则 skip。
 * 覆盖：上传企微存档 → 嗅探 → 清洗 → 配对 → 审核清单 → confirm 写数据集 → rollback。
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ImportJobService } from '../../src/import/import-job.service.js';
import { SensitiveRedactor } from '../../src/import/sensitive-redactor.js';
import { InMemoryDatasetClient } from '../../src/import/fastgpt-dataset.client.js';
import { NoopSearchClient } from '../../src/import/near-duplicate.js';
import { setConfig, resetConfig } from '../__setup__/test-helpers.js';

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

async function applyMigrations(pool: Pool): Promise<void> {
  const { readdirSync, readFileSync } = await import('node:fs');
  const src = join(process.cwd(), 'src');
  const files: { seq: string; path: string }[] = [];
  for (const dir of readdirSync(src, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(join(src, dir.name))) {
      const m = /^(\d{3})-.*\.sql$/.exec(f);
      if (m) files.push({ seq: m[1], path: join(src, dir.name, f) });
    }
  }
  files.sort((a, b) => a.seq.localeCompare(b.seq));
  for (const { path } of files) {
    try {
      await pool.query(readFileSync(path, 'utf8'));
    } catch (err) {
      if (/already exists|duplicate/i.test((err as Error).message)) continue;
      throw err;
    }
  }
}

suite('M10 导入重管线 e2e', () => {
  let pool: Pool;
  let svc: ImportJobService;
  let dataset: InMemoryDatasetClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);
    // 清理历史的导入数据，避免同源短路命中旧 job
    await pool.query('DELETE FROM import_unpaired');
    await pool.query('DELETE FROM import_item');
    await pool.query('DELETE FROM import_job');
    setConfig({ DATABASE_URL: PG_URL, IMPORT_RULES_FILE: '', IMPORT_BLACKLIST_FILE: '' });
    const { ConfigService } = await import('../../src/config/config.service.js');
    svc = new ImportJobService({} as any, new SensitiveRedactor());
    void ConfigService;
    dataset = new InMemoryDatasetClient();
    svc.setDatasetClient(dataset);
    svc.setSearchClient(new NoopSearchClient());
  });

  afterAll(async () => {
    await pool?.end();
    resetConfig();
  });

  it('企微存档 → 清洗配对 → 清单 → confirm 写数据集 → rollback', async () => {
    const archive = JSON.stringify([
      { sender: '客户张三', content: '请问订单怎么退款', time: 1000 },
      { sender: '客服小李', content: '您在订单页点击申请退款即可', time: 2000 },
      { sender: '客户张三', content: '[图片]', time: 3000 },
      { sender: '系统', content: '张三加入了群聊', time: 4000 },
      { sender: '客户张三', content: '退款多久到账', time: 5000 },
      { sender: '客服小李', content: '一般 1-3 个工作日到账', time: 6000 },
    ]);
    const created = await svc.createFromFile({
      filename: 'archive.json',
      mimeType: 'application/json',
      bytes: Buffer.from(archive, 'utf8'),
      name: 'e2e-archive',
    });
    expect(created.reused).toBe(false);
    const jobId = created.job.id;

    const parsed = await svc.parseJob(jobId);
    expect(parsed.status).toBe('parsed');
    expect(parsed.sourceShape).toBe('wecom-archive');
    expect(parsed.pairedCount).toBe(2); // 两条配对
    expect(parsed.unpairedCount).toBe(0);

    // 清单可生成
    const manifest = await svc.buildManifest(jobId);
    expect(manifest.subarray(0, 2).toString('latin1')).toBe('PK');

    // 全部 approved → confirm 写数据集
    const itemsRes = await pool.query('SELECT id FROM import_item WHERE job_id = $1', [jobId]);
    const decisions = itemsRes.rows.map((r) => ({ itemId: r.id, reviewStatus: 'approved' as const }));
    const res = await svc.confirm(jobId, decisions);
    expect(res.approved).toBe(2);
    expect(res.written).toBe(2);
    expect(dataset.datasets.get(res.dataset)).toHaveLength(2);

    const imported = await pool.query(
      'SELECT COUNT(*)::int AS n FROM import_item WHERE job_id = $1 AND imported_qa_id IS NOT NULL',
      [jobId],
    );
    expect(imported.rows[0].n).toBe(2);

    // rollback 删除数据集
    await svc.rollback(jobId);
    expect(dataset.datasets.has(res.dataset)).toBe(false);
    const cleared = await pool.query(
      'SELECT COUNT(*)::int AS n FROM import_item WHERE job_id = $1 AND imported_qa_id IS NOT NULL',
      [jobId],
    );
    expect(cleared.rows[0].n).toBe(0);

    // 清理（confirm 后 job 为 approved，deleteJob 禁止；测试直接删库）
    await pool.query('DELETE FROM import_job WHERE id = $1', [jobId]);
    await fs.rm(join(process.cwd(), 'data', 'import', jobId), { recursive: true, force: true });
  });
});
