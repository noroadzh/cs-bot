/**
 * 流式导入：JSON 数组增量解析、流式配对、头部嗅探
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { iterateJsonArray, readXlsxHeaderFromFile, streamConversationMessages } from '../src/import/message-stream.js';
import { StreamingQaPairing } from '../src/import/qa-pairing.js';
import { sniffShapeHead } from '../src/import/content-sniffer.js';
import type { CleanMessage } from '../src/import/import-cleaner.js';

jest.setTimeout(60_000);

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'csbot-stream-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const msg = (over: Partial<CleanMessage> = {}): CleanMessage => ({
  conversationId: 'c1', senderId: 'u1', senderType: 'customer',
  content: '问题', occurredAt: 1000, ...over,
});

describe('iterateJsonArray', () => {
  it('跨块/字符串含花括号也能逐个解析', async () => {
    const file = join(dir, 'a.json');
    const payload = [
      { sender: '客户', content: '含 } 和 { 的内容', time: 1 },
      { sender: '客服', content: '回答', time: 2 },
    ];
    await writeFile(file, JSON.stringify(payload), 'utf8');
    const out: unknown[] = [];
    for await (const e of iterateJsonArray(file)) out.push(e);
    expect(out).toHaveLength(2);
    expect((out[0] as any).content).toContain('}');
  });
});

describe('StreamingQaPairing', () => {
  it('按会话/窗口增量配对并 drain', () => {
    const p = new StreamingQaPairing(60_000, 3);
    p.push(msg({ content: 'Q1', occurredAt: 0 }));
    p.push(msg({ senderType: 'service', senderId: 's1', content: 'ANSWER1', occurredAt: 10 }));
    p.push(msg({ content: 'Q2', occurredAt: 20 }));
    // 超 60s 窗口 → Q2 未配对
    p.push(msg({ content: 'Q3', occurredAt: 100_000 }));
    p.push(msg({ senderType: 'service', senderId: 's1', content: 'ANSWER3', occurredAt: 100_010 }));
    p.finish();
    const out = p.drain();
    expect(out.paired).toEqual([
      { question: 'Q1', answer: 'ANSWER1', conversationId: 'c1', occurredAt: 0 },
      { question: 'Q3', answer: 'ANSWER3', conversationId: 'c1', occurredAt: 100_000 },
    ]);
    expect(out.unpaired.map((m) => m.content)).toEqual(['Q2']);
  });
});

describe('XLSX 流式解析', () => {
  it('逐行产出会话消息并读取首行表头', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['时间', '说话方', '内容']);
    ws.addRow(['2026-01-01 10:00:00', '客户', '怎么退款']);
    ws.addRow(['2026-01-01 10:01:00', '客服', '请在订单页申请']);
    const file = join(dir, 'conv.xlsx');
    await wb.xlsx.writeFile(file);

    expect(await readXlsxHeaderFromFile(file)).toEqual(['时间', '说话方', '内容']);
    const out: any[] = [];
    for await (const m of streamConversationMessages(file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'conversation-table')) {
      out.push(m);
    }
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ senderType: 'customer', content: '怎么退款' });
    expect(out[1]).toMatchObject({ senderType: 'service', content: '请在订单页申请' });
  }, 20_000);
});

describe('sniffShapeHead', () => {
  it('JSON 存档/QA 与 CSV 表头', () => {
    expect(sniffShapeHead(Buffer.from('[{"sender":"客户","content":"hi"}]'), 'application/json')).toBe('wecom-archive');
    expect(sniffShapeHead(Buffer.from('[{"question":"q","answer":"a"}]'), 'application/json')).toBe('qa-pairs');
    expect(sniffShapeHead(Buffer.from('时间,说话方,内容\n1,客户,hi\n'), 'text/csv')).toBe('conversation-table');
    expect(sniffShapeHead(Buffer.from('question,answer\nq,a\n'), 'text/csv')).toBe('qa-pairs');
  });
});
