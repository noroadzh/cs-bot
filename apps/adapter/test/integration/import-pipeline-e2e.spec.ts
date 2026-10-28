/**
 * M10 重管线端到端（真实 PG + InMemoryDatasetClient）
 *
 * 需要 TEST_PG_URL；未设置则 skip。
 * 覆盖：上传企微存档 → 嗅探 → 清洗 → 配对 → 审核清单 → confirm 写数据集 → rollback。
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import { applyMigrations } from '../__setup__/migrations.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ImportJobService } from '../../src/import/import-job.service.js';
import { SensitiveRedactor } from '../../src/import/sensitive-redactor.js';
import { InMemoryDatasetClient, type DatasetClient } from '../../src/import/fastgpt-dataset.client.js';
import { NoopSearchClient } from '../../src/import/near-duplicate.js';
import { setConfig, resetConfig } from '../__setup__/test-helpers.js';

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

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
    expect(parsed.totalMessages).toBe(6);
    expect(parsed.parsedMessages).toBe(4);

    // 条目带真实会话元数据
    const meta = await pool.query(
      'SELECT source_hash, session_hash, occurred_at FROM import_item WHERE job_id = $1',
      [jobId],
    );
    for (const row of meta.rows) {
      expect(row.source_hash).toHaveLength(64);
      expect(row.session_hash).toHaveLength(32);
      expect(row.occurred_at).not.toBeNull();
    }

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
    const rolled = await pool.query('SELECT status, imported_count FROM import_job WHERE id = $1', [jobId]);
    expect(rolled.rows[0].status).toBe('rolled_back');
    expect(rolled.rows[0].imported_count).toBe(0);
    const cleared = await pool.query(
      'SELECT COUNT(*)::int AS n FROM import_item WHERE job_id = $1 AND imported_qa_id IS NOT NULL',
      [jobId],
    );
    expect(cleared.rows[0].n).toBe(0);

    // 清理（confirm 后 job 为 approved，deleteJob 禁止；测试直接删库）
    await pool.query('DELETE FROM import_job WHERE id = $1', [jobId]);
    await fs.rm(join(process.cwd(), 'data', 'import', jobId), { recursive: true, force: true });
  });

  it('同一批次重复问答只入库一次并计数', async () => {
    const stamp = Date.now();
    const csv = [
      'question,answer',
      `问A-${stamp},答A-${stamp}`,
      `问A-${stamp},答A-${stamp}`,
      `问B-${stamp},答B-${stamp}`,
    ].join('\n');
    const created = await svc.createFromFile({
      filename: 'dup.csv', mimeType: 'text/csv', bytes: Buffer.from(csv, 'utf8'),
    });
    const parsed = await svc.parseJob(created.job.id);
    expect(parsed.itemCount).toBe(2);
    expect(parsed.dedupCount).toBe(1);
    const rows = await pool.query(
      'SELECT COUNT(*)::int AS n, COUNT(session_hash)::int AS sessions FROM import_item WHERE job_id = $1',
      [created.job.id],
    );
    expect(rows.rows[0].n).toBe(2);
    // 直接配对格式没有会话元数据
    expect(rows.rows[0].sessions).toBe(0);
    const meta = await pool.query(
      'SELECT COUNT(occurred_at)::int AS times FROM import_item WHERE job_id = $1',
      [created.job.id],
    );
    expect(meta.rows[0].times).toBe(0);
    await pool.query('DELETE FROM import_job WHERE id = $1', [created.job.id]);
  });

  it('丢弃条目清空正文，修改条目按修订文本入库', async () => {
    const stamp = Date.now();
    const csv = ['question,answer', `丢-${stamp},待丢弃`, `改-${stamp},原答案`].join('\n');
    const created = await svc.createFromFile({
      filename: 'review.csv', mimeType: 'text/csv', bytes: Buffer.from(csv, 'utf8'),
    });
    const jobId = created.job.id;
    await svc.parseJob(jobId);
    const items = await pool.query(
      'SELECT id, question FROM import_item WHERE job_id = $1 ORDER BY question ASC',
      [jobId],
    );
    const drop = items.rows.find((r) => String(r.question).startsWith('丢'))!;
    const modify = items.rows.find((r) => String(r.question).startsWith('改'))!;
    await svc.reviewItem(jobId, String(drop.id), { reviewStatus: 'rejected' });
    await svc.reviewItem(jobId, String(modify.id), {
      reviewStatus: 'modified', answer: `修订答案-${stamp}`, note: '修正',
    });
    const res = await svc.confirm(jobId, []);
    expect(res.written).toBe(1);
    expect(dataset.datasets.get(res.dataset)![0].answer).toBe(`修订答案-${stamp}`);
    const dropped = await pool.query(
      'SELECT question, answer_raw, answer_redacted, source_hash FROM import_item WHERE id = $1',
      [drop.id],
    );
    expect(dropped.rows[0].question).toBeNull();
    expect(dropped.rows[0].answer_raw).toBeNull();
    expect(dropped.rows[0].answer_redacted).toBeNull();
    expect(dropped.rows[0].source_hash).toHaveLength(64);
    const job = await pool.query('SELECT approved_count, imported_count, failed_count FROM import_job WHERE id = $1', [jobId]);
    expect(job.rows[0].approved_count).toBe(1);
    expect(job.rows[0].imported_count).toBe(1);
    expect(job.rows[0].failed_count).toBe(0);
    await pool.query('DELETE FROM import_job WHERE id = $1', [jobId]);
  });

  it('租约存在时拒绝并发导入，强制释放后可继续', async () => {
    const stamp = Date.now();
    const csv = ['question,answer', `锁-${stamp},答案`].join('\n');
    const created = await svc.createFromFile({
      filename: 'lock.csv', mimeType: 'text/csv', bytes: Buffer.from(csv, 'utf8'),
    });
    const jobId = created.job.id;
    await pool.query(
      "INSERT INTO import_lock (id, job_id, stage, heartbeat_at) VALUES (1, $1, 'parsing', NOW())",
      [jobId],
    );
    let errCode = '';
    try {
      await svc.parseJob(jobId);
    } catch (e) {
      errCode = (e as any).getResponse?.().errCode;
    }
    expect(errCode).toBe('IMPORT_BUSY');
    await svc.forceReleaseImportLock();
    const parsed = await svc.parseJob(jobId);
    expect(parsed.status).toBe('parsed');
    await pool.query('DELETE FROM import_job WHERE id = $1', [jobId]);
  });

  it('失败导入也刷新计数：approved/imported/failed 可观测', async () => {
    const stamp = Date.now();
    const lines = ['question,answer'];
    for (let i = 0; i < 120; i += 1) lines.push(`失败问-${stamp}-${i},失败答-${stamp}-${i}`);
    const created = await svc.createFromFile({
      filename: 'fail.csv', mimeType: 'text/csv', bytes: Buffer.from(lines.join('\n'), 'utf8'),
    });
    const jobId = created.job.id;
    await svc.parseJob(jobId);
    await svc.approveAll(jobId);
    let calls = 0;
    const failing: DatasetClient = {
      ensureDataset: async (name: string) => name,
      writeBatch: async (_id: string, items: readonly { question: string; answer: string }[]) => {
        calls += 1;
        if (calls >= 2) throw new Error('dataset write failed');
        return items.map((_, i) => `qa-${stamp}-${i}`);
      },
      deleteDataset: async () => undefined,
    };
    svc.setDatasetClient(failing);
    await expect(svc.confirm(jobId, [])).rejects.toThrow(/dataset write failed/);
    const row = await pool.query(
      'SELECT approved_count, imported_count, failed_count FROM import_job WHERE id = $1',
      [jobId],
    );
    expect(row.rows[0].approved_count).toBe(120);
    expect(row.rows[0].imported_count).toBe(50);
    expect(row.rows[0].failed_count).toBe(70);
    await pool.query('DELETE FROM import_job WHERE id = $1', [jobId]);
    svc.setDatasetClient(dataset);
  });

  it('解析失败释放租约，下一个任务可继续', async () => {
    const stamp = Date.now();
    const a = await svc.createFromFile({
      filename: 'bad.csv', mimeType: 'text/csv', bytes: Buffer.from(`question,answer\n坏-${stamp},答`, 'utf8'),
    });
    await fs.rm(join(process.cwd(), 'data', 'import', a.job.id), { recursive: true, force: true });
    const failed = await svc.parseJob(a.job.id);
    expect(failed.status).toBe('failed');
    const b = await svc.createFromFile({
      filename: 'ok.csv', mimeType: 'text/csv', bytes: Buffer.from(`question,answer\n好-${stamp},答好`, 'utf8'),
    });
    const ok = await svc.parseJob(b.job.id);
    expect(ok.status).toBe('parsed');
    await pool.query('DELETE FROM import_job WHERE id = ANY($1::uuid[])', [[a.job.id, b.job.id]]);
  });

  it('入库阶段与解析共享互斥租约', async () => {
    const stamp = Date.now();
    const created = await svc.createFromFile({
      filename: 'excl.csv', mimeType: 'text/csv', bytes: Buffer.from(`question,answer\n互斥-${stamp},答`, 'utf8'),
    });
    await svc.parseJob(created.job.id);
    await pool.query(
      "INSERT INTO import_lock (id, job_id, stage, heartbeat_at) VALUES (1, $1, 'importing', NOW())",
      [created.job.id],
    );
    let code = '';
    try {
      await svc.confirm(created.job.id, []);
    } catch (e) {
      code = (e as any).getResponse?.().errCode;
    }
    expect(code).toBe('IMPORT_BUSY');
    await svc.forceReleaseImportLock();
    await pool.query('DELETE FROM import_job WHERE id = $1', [created.job.id]);
  });

  it('重复回滚幂等且状态保持 rolled_back', async () => {
    const stamp = Date.now();
    const created = await svc.createFromFile({
      filename: 'rb.csv', mimeType: 'text/csv', bytes: Buffer.from(`question,answer\n回滚-${stamp},答`, 'utf8'),
    });
    const jobId = created.job.id;
    await svc.parseJob(jobId);
    await svc.approveAll(jobId);
    await svc.confirm(jobId, []);
    await svc.rollback(jobId);
    await expect(svc.rollback(jobId)).resolves.toEqual({ rolledBack: true });
    const after = await pool.query('SELECT status FROM import_job WHERE id = $1', [jobId]);
    expect(after.rows[0].status).toBe('rolled_back');
    const item = await pool.query('SELECT id FROM import_item WHERE job_id = $1 LIMIT 1', [jobId]);
    await svc.reviewItem(jobId, String(item.rows[0].id), { reviewStatus: 'rejected' });
    const still = await pool.query('SELECT status FROM import_job WHERE id = $1', [jobId]);
    expect(still.rows[0].status).toBe('rolled_back');
    await pool.query('DELETE FROM import_job WHERE id = $1', [jobId]);
  });

  it('跨批次重复问答被去重', async () => {
    const stamp = Date.now();
    const a = await svc.createFromFile({
      filename: 'a.csv', mimeType: 'text/csv', bytes: Buffer.from(`question,answer\n跨批-${stamp},答`, 'utf8'),
    });
    await svc.parseJob(a.job.id);
    const b = await svc.createFromFile({
      filename: 'b.csv', mimeType: 'text/csv',
      bytes: Buffer.from(`question,answer\n跨批-${stamp},答\n新增-${stamp},答2`, 'utf8'),
    });
    const parsed = await svc.parseJob(b.job.id);
    expect(parsed.itemCount).toBe(1);
    expect(parsed.dedupCount).toBe(1);
    await pool.query('DELETE FROM import_job WHERE id = ANY($1::uuid[])', [[a.job.id, b.job.id]]);
  });

  it('modified 缺少修订答案返回 400', async () => {
    const stamp = Date.now();
    const created = await svc.createFromFile({
      filename: 'mod.csv', mimeType: 'text/csv', bytes: Buffer.from(`question,answer\n修改-${stamp},答`, 'utf8'),
    });
    await svc.parseJob(created.job.id);
    const items = await pool.query('SELECT id FROM import_item WHERE job_id = $1 LIMIT 1', [created.job.id]);
    let status = 0;
    try {
      await svc.reviewItem(created.job.id, String(items.rows[0].id), { reviewStatus: 'modified' });
    } catch (e) {
      status = (e as any).getStatus();
    }
    expect(status).toBe(400);
    await pool.query('DELETE FROM import_job WHERE id = $1', [created.job.id]);
  });

  it('重启后立即清理残留租约', async () => {
    const stamp = Date.now();
    const created = await svc.createFromFile({
      filename: 'boot.csv', mimeType: 'text/csv', bytes: Buffer.from(`question,answer\n启动-${stamp},答`, 'utf8'),
    });
    await pool.query(
      "INSERT INTO import_lock (id, job_id, stage, heartbeat_at) VALUES (1, '00000000-0000-0000-0000-000000000000', 'parsing', NOW())",
    );
    await svc.onModuleInit();
    const parsed = await svc.parseJob(created.job.id);
    expect(parsed.status).toBe('parsed');
    await pool.query('DELETE FROM import_job WHERE id = $1', [created.job.id]);
  });
});
