/**
 * 审核清单取值：会话哈希与发生时间必须来自条目自身，缺失时渲染 —
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: poolQuery })) }));

import { ImportJobService } from '../src/import/import-job.service.js';
import { SensitiveRedactor } from '../src/import/sensitive-redactor.js';

const jobRow = {
  id: 'job-manifest',
  name: 'm',
  source_filename: 'm.csv',
  source_hash: 'f'.repeat(64),
  status: 'parsed',
  item_count: 2,
  parse_error: null,
  cleaned_count: 0, paired_count: 2, unpaired_count: 0,
  total_msgs: 2, parsed_msgs: 2, masked_count: 0, blocked_count: 0,
  dedup_count: 0, approved_count: 0, imported_count: 0, failed_count: 0,
  dataset_name: null, source_shape: 'qa-pairs',
  created_at: new Date('2026-10-28T00:00:00Z'),
  updated_at: new Date('2026-10-28T00:00:00Z'),
};

const item = (over: Record<string, unknown>) => ({
  id: 'i', job_id: 'job-manifest', question: 'q', answer_raw: 'a', answer_redacted: 'a',
  sensitive_flags: [], review_status: 'pending', created_at: new Date('2026-10-28T00:00:00Z'),
  similar_qa_id: null, suggest_action: null,
  ...over,
});

describe('review manifest metadata', () => {
  beforeAll(() => {
    setConfig({ IMPORT_RULES_FILE: '', IMPORT_BLACKLIST_FILE: '' });
  });
  afterAll(async () => {
    resetConfig();
    await rm(join(process.cwd(), 'data', 'import', 'job-manifest'), { recursive: true, force: true });
  });

  it('uses each item session hash and conversation time, with — when absent', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('manifest_generated_at')) return { rows: [{ id: 'job-manifest', manifest_generated_at: null }] };
      if (sql.includes('UPDATE import_job')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM import_item')) {
        return {
          rows: [
            item({
              id: 'i1',
              session_hash: 'abcdef1234567890abcdef1234567890',
              occurred_at: new Date('2026-01-02T03:04:05Z'),
            }),
            item({ id: 'i2', question: 'q2', session_hash: null, occurred_at: null }),
          ],
        };
      }
      return { rows: [] };
    });
    const svc = new ImportJobService({} as any, new SensitiveRedactor());
    const buf = await svc.buildManifest('job-manifest');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    expect(ws.getRow(2).getCell(2).value).toBe('abcdef123456');
    expect(String(ws.getRow(2).getCell(3).value)).toContain('2026-01-02');
    expect(ws.getRow(3).getCell(2).value).toBe('—');
    expect(ws.getRow(3).getCell(3).value).toBe('—');
  });

  it('returns 410 after the 30-day retention window', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('manifest_generated_at')) {
        return { rows: [{ id: 'job-manifest', manifest_generated_at: old }] };
      }
      return { rows: [] };
    });
    const svc = new ImportJobService({} as any, new SensitiveRedactor());
    let status = 0;
    try {
      await svc.buildManifest('job-manifest');
    } catch (e) {
      status = (e as any).getStatus();
    }
    expect(status).toBe(410);
  });
});
