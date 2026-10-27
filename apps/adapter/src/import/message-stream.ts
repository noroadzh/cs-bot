/**
 * 会话文件流式解析（JSON 数组 / CSV），逐条产出 CleanMessage，避免整文件入内存。
 * XLSX 仍走 exceljs 缓冲路径（见 parseJob）。
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseCsvLine } from './csv-stream.js';
import {
  MissingColumnError,
  UnsupportedFormatError,
  resolveColumnKeys,
  SUPPORTED_MIME_TYPES,
} from './import-parser.js';
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

/** 流式解析顶层 JSON 数组，逐个产出元素（不加载整个数组） */
export async function* iterateJsonArray(path: string): AsyncGenerator<unknown> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  let buf = '';
  let started = false;
  let objStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  try {
    for await (const chunk of stream) {
      buf += chunk;
      let i = 0;
      while (i < buf.length) {
        const ch = buf[i];
        if (!started) {
          if (ch === '[') started = true;
          i += 1;
          continue;
        }
        if (objStart < 0) {
          if (ch === '{') {
            objStart = i;
            depth = 1;
            inString = false;
            escaped = false;
          }
          i += 1;
          continue;
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          i += 1;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            const text = buf.slice(objStart, i + 1);
            yield JSON.parse(text);
            objStart = -1;
          }
        }
        i += 1;
      }
      if (objStart >= 0) buf = buf.slice(objStart);
      else buf = buf.slice(Math.max(0, buf.length - 1));
      if (objStart >= 0) {
        // 保持 objStart 相对新 buffer 的索引
        objStart = 0;
      }
    }
  } finally {
    stream.close();
  }
}

function archiveMessage(e: unknown, fallbackConv: string): CleanMessage | null {
  if (e === null || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const content = String(o.content ?? o.text ?? o.Content ?? '').trim();
  if (!content) return null;
  const who = String(o.sender ?? o.senderId ?? o.from ?? o.FromUserName ?? '');
  const conv = String(o.conversationId ?? o.chatId ?? o.ChatId ?? fallbackConv);
  return {
    conversationId: conv,
    senderId: who || 'unknown',
    senderType: detectSenderType(who),
    content,
    occurredAt: parseTime(o.time ?? o.occurredAt ?? o.createTime ?? o.CreateTime),
  };
}

async function* streamXlsxConversation(path: string, fallbackConv: string): AsyncGenerator<CleanMessage> {
  const ExcelJS = (await import('exceljs')).default;
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
    entries: 'emit',
  });
  let header: string[] | null = null;
  let ti = -1;
  let si = -1;
  let ci = -1;
  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell: { value: unknown }) => vals.push(String(cell.value ?? '')));
      if (header === null) {
        header = vals.map((v) => v.trim());
        ti = header.findIndex((h) => h === '时间' || h === '发生时间');
        si = header.findIndex((h) => h === '说话方' || h === '发送方' || h === '发言人');
        ci = header.findIndex((h) => h === '内容' || h === '消息内容');
        continue;
      }
      if (ti < 0 || si < 0 || ci < 0) return;
      const content = (vals[ci] ?? '').trim();
      if (!content) continue;
      const who = (vals[si] ?? '').trim();
      yield {
        conversationId: fallbackConv,
        senderId: who || 'unknown',
        senderType: detectSenderType(who),
        content,
        occurredAt: parseTime(vals[ti]),
      };
    }
    break; // 只处理首个工作表
  }
}

/** 流式读取 XLSX 首行（嗅探用，不加载整个 workbook） */
export async function readXlsxHeaderFromFile(path: string): Promise<string[] | undefined> {
  try {
    const ExcelJS = (await import('exceljs')).default;
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
      sharedStrings: 'cache',
      worksheets: 'emit',
      entries: 'emit',
    });
    for await (const worksheet of reader) {
      for await (const row of worksheet) {
        const vals: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell: { value: unknown }) => vals.push(String(cell.value ?? '')));
        return vals;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function* streamCsvConversation(path: string, fallbackConv: string): AsyncGenerator<CleanMessage> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header: string[] | null = null;
  let ti = -1;
  let si = -1;
  let ci = -1;
  try {
    for await (const line of rl) {
      if (line.trim() === '') continue;
      const cells = parseCsvLine(line);
      if (header === null) {
        header = cells.map((h) => h.trim());
        ti = header.findIndex((h) => h === '时间' || h === '发生时间');
        si = header.findIndex((h) => h === '说话方' || h === '发送方' || h === '发言人');
        ci = header.findIndex((h) => h === '内容' || h === '消息内容');
        continue;
      }
      if (ti < 0 || si < 0 || ci < 0) return;
      const content = (cells[ci] ?? '').trim();
      if (!content) continue;
      const who = (cells[si] ?? '').trim();
      yield {
        conversationId: fallbackConv,
        senderId: who || 'unknown',
        senderType: detectSenderType(who),
        content,
        occurredAt: parseTime(cells[ti]),
      };
    }
  } finally {
    rl.close();
  }
}

export async function* streamConversationMessages(
  path: string,
  mimeType: string,
  shape: ImportShape,
  fallbackConv = 'default',
): AsyncGenerator<CleanMessage> {
  if (shape === 'wecom-archive') {
    for await (const e of iterateJsonArray(path)) {
      const m = archiveMessage(e, fallbackConv);
      if (m) yield m;
    }
    return;
  }
  if (mimeType === 'text/csv') {
    yield* streamCsvConversation(path, fallbackConv);
  }
  if (mimeType.includes('spreadsheetml')) {
    yield* streamXlsxConversation(path, fallbackConv);
  }
}


/** 直接成对 QA 文件流式解析（JSONL/CSV/TXT/XLSX） */
export async function* streamQaPairs(
  path: string,
  mimeType: string,
): AsyncGenerator<{ question: string; answer: string }> {
  const mime = mimeType.toLowerCase().trim();
  if (mime === 'application/json' || mime === 'application/jsonl' || mime === 'application/x-jsonlines') {
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    let i = 0;
    try {
      for await (const line of rl) {
        i += 1;
        const t = line.trim();
        if (t === '') continue;
        let obj: unknown;
        try {
          obj = JSON.parse(t);
        } catch {
          throw new SyntaxError(`jsonl line ${i} is not valid JSON`);
        }
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
          throw new SyntaxError(`jsonl line ${i} must be a JSON object`);
        }
        const rec = obj as Record<string, unknown>;
        const { q, a } = resolveColumnKeys(Object.keys(rec));
        if (q === null || a === null) throw new MissingColumnError('JSONL', Object.keys(rec));
        const question = String(rec[q] ?? '').trim();
        const answer = String(rec[a] ?? '').trim();
        if (question === '' && answer === '') continue;
        yield { question, answer };
      }
    } finally {
      rl.close();
    }
    return;
  }

  if (mime === 'text/csv' || mime === 'application/csv') {
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    let header: string[] | null = null;
    let qi = -1;
    let ai = -1;
    try {
      for await (const line of rl) {
        if (line.trim() === '') continue;
        const cells = parseCsvLine(line);
        if (header === null) {
          header = cells;
          const { q, a } = resolveColumnKeys(header);
          if (q === null || a === null) throw new MissingColumnError('CSV', header);
          qi = header.indexOf(q);
          ai = header.indexOf(a);
          continue;
        }
        yield { question: (cells[qi] ?? '').trim(), answer: (cells[ai] ?? '').trim() };
      }
    } finally {
      rl.close();
    }
    return;
  }

  if (mime === 'text/plain') {
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    let question: string | null = null;
    let answer: string[] = [];
    let found = false;
    const flush = function* (): Generator<{ question: string; answer: string }> {
      if (question !== null) {
        found = true;
        yield { question: question.trim(), answer: answer.join('\n').trim() };
      }
      question = null;
      answer = [];
    };
    try {
      for await (const line of rl) {
        const qm = /^Q:\s*(.*)$/i.exec(line);
        if (qm) {
          yield* flush();
          question = qm[1];
          continue;
        }
        const am = /^A:\s*(.*)$/i.exec(line);
        if (am && question !== null) {
          answer.push(am[1]);
          continue;
        }
        if (question !== null && line.trim() !== '') answer.push(line);
      }
      yield* flush();
      if (!found) throw new MissingColumnError('TXT', ['(expected "Q:" / "A:" markers)']);
    } finally {
      rl.close();
    }
    return;
  }

  if (mime.includes('spreadsheetml')) {
    const ExcelJS = (await import('exceljs')).default;
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
      sharedStrings: 'cache', worksheets: 'emit', entries: 'emit',
    });
    let header: string[] | null = null;
    let qi = -1;
    let ai = -1;
    for await (const worksheet of reader) {
      for await (const row of worksheet) {
        const vals: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell: { value: unknown }) => vals.push(String(cell.value ?? '')));
        if (header === null) {
          header = vals;
          const { q, a } = resolveColumnKeys(header);
          if (q === null || a === null) throw new MissingColumnError('XLSX', header);
          qi = header.indexOf(q);
          ai = header.indexOf(a);
          continue;
        }
        yield { question: (vals[qi] ?? '').trim(), answer: (vals[ai] ?? '').trim() };
      }
      break;
    }
    return;
  }

  throw new UnsupportedFormatError(mimeType, SUPPORTED_MIME_TYPES);
}
