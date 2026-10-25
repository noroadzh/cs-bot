/**
 * ConversationParser — 把会话形态的上传文件解析为 CleanMessage[]（供清洗/配对）
 *
 * 支持：企微会话存档 JSON（message 数组）、三列表（时间/说话方/内容；csv 或 xlsx）。
 */
import { parseCsv } from './import-parser.js';
import type { CleanMessage, SenderType } from './import-cleaner.js';
import type { ImportShape } from './content-sniffer.js';

function detectSenderType(who: string): SenderType {
  const w = who.trim();
  if (/机器人|bot/i.test(w)) return 'bot';
  if (/系统|system/i.test(w)) return 'system';
  if (/客服|服务|agent|staff|坐席/i.test(w)) return 'service';
  return 'customer';
}

function parseTime(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return Date.now();
  const t = Date.parse(s.replace(/\//g, '-'));
  return Number.isNaN(t) ? Date.now() : t;
}

function parseArchiveJson(bytes: Buffer, fallbackConv: string): CleanMessage[] {
  const arr = JSON.parse(bytes.toString('utf8')) as unknown[];
  const out: CleanMessage[] = [];
  for (const e of arr) {
    if (e === null || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const content = String(o.content ?? o.text ?? o.Content ?? '').trim();
    if (!content) continue;
    const who = String(o.sender ?? o.senderId ?? o.from ?? o.FromUserName ?? '');
    const conv = String(o.conversationId ?? o.chatId ?? o.ChatId ?? fallbackConv);
    out.push({
      conversationId: conv,
      senderId: who || 'unknown',
      senderType: detectSenderType(who),
      content,
      occurredAt: parseTime(o.time ?? o.occurredAt ?? o.createTime ?? o.CreateTime),
    });
  }
  return out;
}

function rowsToMessages(rows: string[][], fallbackConv: string): CleanMessage[] {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const ti = header.findIndex((h) => h === '时间' || h === '发生时间');
  const si = header.findIndex((h) => h === '说话方' || h === '发送方' || h === '发言人');
  const ci = header.findIndex((h) => h === '内容' || h === '消息内容');
  if (ti < 0 || si < 0 || ci < 0) return [];
  const out: CleanMessage[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const content = (r[ci] ?? '').trim();
    if (!content) continue;
    const who = (r[si] ?? '').trim();
    out.push({
      conversationId: fallbackConv,
      senderId: who || 'unknown',
      senderType: detectSenderType(who),
      content,
      occurredAt: parseTime(r[ti]),
    });
  }
  return out;
}

async function readXlsxRows(bytes: Buffer): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => vals.push(String(cell.value ?? '')));
    rows.push(vals);
  });
  return rows;
}

/** 读 XLSX 首行（供 content-sniffer 判断三列表头） */
export async function readXlsxHeader(bytes: Buffer): Promise<string[] | undefined> {
  try {
    const rows = await readXlsxRows(bytes);
    return rows[0];
  } catch {
    return undefined;
  }
}

export async function parseConversation(
  bytes: Buffer,
  mimeType: string,
  shape: ImportShape,
  fallbackConv = 'default',
): Promise<CleanMessage[]> {
  if (shape === 'wecom-archive') {
    return parseArchiveJson(bytes, fallbackConv);
  }
  // conversation-table
  if (mimeType === 'text/csv') {
    return rowsToMessages(parseCsv(bytes.toString('utf8')), fallbackConv);
  }
  if (mimeType.includes('spreadsheetml')) {
    return rowsToMessages(await readXlsxRows(bytes), fallbackConv);
  }
  return [];
}
