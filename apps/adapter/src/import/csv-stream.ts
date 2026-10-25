/**
 * CsvStream — 大文件 CSV 逐行流式解析（概设 §5 M10 步骤 2：逐条处理即释放）
 *
 * 从文件流逐行读取，避免整文件进内存，峰值内存受单行大小约束。
 * 行内支持引号转义；跨行引号（引号内含换行）为流式简化前提下的已知限制。
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { MissingColumnError, resolveColumnKeys, type ParsedRow } from './import-parser.js';

/** 解析单行 CSV（含引号转义） */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 逐行流式解析 CSV 文件为 ParsedRow[]。
 * 首行视为表头（需含 question/answer 列）。
 */
export async function parseCsvFileStream(path: string): Promise<ParsedRow[]> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const rows: ParsedRow[] = [];
  let header: string[] | null = null;
  let qi = -1;
  let ai = -1;
  let rowIndex = 0;

  try {
    for await (const line of rl) {
      rowIndex++;
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
      rows.push({
        rowIndex,
        question: (cells[qi] ?? '').trim(),
        answer: (cells[ai] ?? '').trim(),
      });
    }
  } finally {
    rl.close();
  }
  return rows;
}
