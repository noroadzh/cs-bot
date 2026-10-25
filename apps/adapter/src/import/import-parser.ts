/**
 * ImportParser — 按 MIME 字典分派到具体解析器。
 * Spec M10 §1.2：4 种格式 CSV / JSONL / TXT / XLSX，未知 MIME → unsupported_format(415)。
 *
 * 每个 parser 输出统一的 ParsedRow[]（一行 = 一条待审条目），
 * 列名约束：必须同时含 question 与 answer（大小写不敏感，允许 Q/A 缩写）。
 */

export interface ParsedRow {
  /** 行序号（从 1 开始，用于审核时定位） */
  rowIndex: number;
  question: string;
  answer: string;
}

export class UnsupportedFormatError extends Error {
  readonly code = 'UNSUPPORTED_MEDIA_TYPE';
  constructor(readonly mimeType: string, readonly allowed: readonly string[]) {
    super(`unsupported MIME type: ${mimeType}`);
    this.name = 'UnsupportedFormatError';
  }
}

export class MissingColumnError extends Error {
  readonly code = 'IMPORT_MISSING_COLUMN';
  constructor(readonly format: string, readonly found: readonly string[]) {
    super(`${format} import requires question and answer columns; found: ${found.join(', ') || '(none)'}`);
    this.name = 'MissingColumnError';
  }
}

/** 列名归一：去空格/下划线/连字符 + 小写 */
const norm = (s: string): string => s.trim().toLowerCase().replace(/[\s_-]+/g, '');

const QUESTION_KEYS = new Set(['question', 'q', '问题', '问']);
const ANSWER_KEYS = new Set(['answer', 'a', '答案', '答']);

/**
 * 从一组键中定位 question / answer 的实际键名。
 * 找不到返回 null，由调用方决定报 MissingColumnError 还是走行内解析。
 */
export function resolveColumnKeys(keys: readonly string[]): { q: string | null; a: string | null } {
  let q: string | null = null;
  let a: string | null = null;
  for (const k of keys) {
    const n = norm(k);
    if (q === null && QUESTION_KEYS.has(n)) q = k;
    if (a === null && ANSWER_KEYS.has(n)) a = k;
  }
  return { q, a };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** 解析 RFC4180 CSV（含引号转义与内嵌换行）。手写而非引依赖：只需覆盖这一子集。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; sawAny = true; continue; }
    if (ch === ',') { row.push(field); field = ''; sawAny = true; continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAny = false;
      continue;
    }
    field += ch;
    sawAny = true;
  }
  // 尾行：文件不以换行结尾时也要收
  if (field !== '' || sawAny || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvParser(text: string): ParsedRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const { q, a } = resolveColumnKeys(header);
  if (q === null || a === null) throw new MissingColumnError('CSV', header);
  const qi = header.indexOf(q);
  const ai = header.indexOf(a);
  const out: ParsedRow[] = [];
  // rowIndex 用原始行号（不过滤后再编号）：审核时按它回溯原始文件定位
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some((c) => c.trim() !== '')) continue; // 全空行跳过
    out.push({
      rowIndex: i,
      question: (r[qi] ?? '').trim(),
      answer: (r[ai] ?? '').trim(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSONL
// ---------------------------------------------------------------------------

export function jsonlParser(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new SyntaxError(`jsonl line ${i + 1} is not valid JSON`);
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      throw new SyntaxError(`jsonl line ${i + 1} must be a JSON object`);
    }
    const rec = obj as Record<string, unknown>;
    const { q, a } = resolveColumnKeys(Object.keys(rec));
    if (q === null || a === null) throw new MissingColumnError('JSONL', Object.keys(rec));
    const question = String(rec[q] ?? '').trim();
    const answer = String(rec[a] ?? '').trim();
    if (question === '' && answer === '') continue; // 空行对象跳过
    out.push({ rowIndex: i + 1, question, answer });
  }
  return out;
}

// ---------------------------------------------------------------------------
// TXT
// ---------------------------------------------------------------------------

/**
 * TXT 约定格式：
 *   Q: 问题文本
 *   A: 答案文本（可跨多行，直到下一个 Q: 或 EOF）
 */
export function txtParser(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/);
  const out: ParsedRow[] = [];
  let current: { rowIndex: number; question: string; answer: string[] } | null = null;

  const flush = (): void => {
    if (current === null) return;
    out.push({
      rowIndex: current.rowIndex,
      question: current.question.trim(),
      answer: current.answer.join('\n').trim(),
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qm = /^Q:\s*(.*)$/i.exec(line);
    if (qm) {
      flush();
      current = { rowIndex: i + 1, question: qm[1], answer: [] };
      continue;
    }
    const am = /^A:\s*(.*)$/i.exec(line);
    if (am && current !== null) {
      current.answer.push(am[1]);
      continue;
    }
    if (current !== null && line.trim() !== '') current.answer.push(line);
  }
  flush();

  if (out.length === 0 && text.trim() !== '') {
    throw new MissingColumnError('TXT', ['(expected "Q:" / "A:" markers)']);
  }
  return out;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/**
 * XLSX 解析：走动态 import('exceljs')，因为它只在需要时才加载。
 * 用项目既有的 exceljs 依赖（不额外引 xlsx），首个 worksheet 为数据源。
 */
export async function xlsxParser(buffer: Buffer): Promise<ParsedRow[]> {
  let ExcelJS: typeof import('exceljs');
  try {
    ExcelJS = await import('exceljs');
  } catch {
    throw new UnsupportedFormatError(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ['xlsx dependency missing'],
    );
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.worksheets[0];
  if (sheet === undefined) return [];

  // 逐行读成 string[][]，跳过全空行
  const matrix: string[][] = [];
  const nonEmptyRowIndexes: number[] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = stringifyCell(cell.value);
    });
    matrix.push(cells);
    if (cells.some((c) => c.trim() !== '')) nonEmptyRowIndexes.push(rowNumber);
  });

  if (nonEmptyRowIndexes.length === 0) return [];
  const headerIdx = nonEmptyRowIndexes[0];
  const header = matrix[headerIdx - 1] ?? [];
  const { q, a } = resolveColumnKeys(header);
  if (q === null || a === null) throw new MissingColumnError('XLSX', header);
  const qi = header.indexOf(q);
  const ai = header.indexOf(a);

  const out: ParsedRow[] = [];
  for (let i = headerIdx; i < nonEmptyRowIndexes.length; i++) {
    const rowIdx = nonEmptyRowIndexes[i];
    const r = matrix[rowIdx - 1] ?? [];
    out.push({
      rowIndex: rowIdx,
      question: (r[qi] ?? '').trim(),
      answer: (r[ai] ?? '').trim(),
    });
  }
  return out;
}

/** exceljs CellValue → 字符串（日期按 ISO，公式取计算结果） */
function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;          // 富文本超链接
    if (typeof o.result === 'string' || typeof o.result === 'number') return String(o.result); // 公式
    if (typeof o.hyperlink === 'string') return o.hyperlink;
    if (o.error !== undefined) return '';
    if (Array.isArray(o.richText)) {
      return o.richText.map((t) => String((t as { text?: string }).text ?? '')).join('');
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// 分派
// ---------------------------------------------------------------------------

/** MIME → parser 字典（spec M10 §1.2） */
export const MIME_PARSERS: Readonly<Record<string, 'csv' | 'jsonl' | 'txt' | 'xlsx'>> = Object.freeze({
  'text/csv': 'csv',
  'application/csv': 'csv',
  'text/plain': 'txt',
  'application/jsonl': 'jsonl',
  'application/x-jsonlines': 'jsonl',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
});

export const SUPPORTED_MIME_TYPES: readonly string[] = Object.keys(MIME_PARSERS);

/** 按 MIME 选 parser；未知 → UnsupportedFormatError */
export function pickParser(mimeType: string): (typeof MIME_PARSERS)[string] {
  const key = MIME_PARSERS[mimeType.toLowerCase().trim()];
  if (key === undefined) throw new UnsupportedFormatError(mimeType, SUPPORTED_MIME_TYPES);
  return key;
}

/**
 * 统一入口：mimeType + 载荷 → ParsedRow[]
 * 文本类格式走字符串；xlsx 走 Buffer（zip 二进制）。
 */
export async function parseImport(
  mimeType: string,
  payload: Buffer,
): Promise<ParsedRow[]> {
  const kind = pickParser(mimeType);
  if (kind === 'xlsx') return xlsxParser(payload);
  const text = payload.toString('utf8');
  switch (kind) {
    case 'csv': return csvParser(text);
    case 'jsonl': return jsonlParser(text);
    case 'txt': return txtParser(text);
  }
}
