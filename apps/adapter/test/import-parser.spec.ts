/**
 * ImportParser 单元测试 — 对应 spec M10 §1.2（4 格式解析 + MIME 字典 + 列约束）
 */
import { describe, it, expect } from '@jest/globals';
import {
  parseImport,
  parseCsv,
  csvParser,
  jsonlParser,
  txtParser,
  pickParser,
  UnsupportedFormatError,
  MissingColumnError,
  MIME_PARSERS,
} from '../src/import/import-parser.js';

describe('parseCsv（RFC4180 子集）', () => {
  it('基础逗号分隔', () => {
    expect(parseCsv('a,b,c\nd,e,f')).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
  });
  it('引号内逗号不切分', () => {
    expect(parseCsv('q,"a,b",c')).toEqual([['q', 'a,b', 'c']]);
  });
  it('双引号转义', () => {
    expect(parseCsv('"he said ""hi"""')).toEqual([['he said "hi"']]);
  });
  it('引号内换行保留', () => {
    expect(parseCsv('q,"line1\nline2"')).toEqual([['q', 'line1\nline2']]);
  });
  it('CRLF 归一', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('文件不以换行结尾也收尾行', () => {
    expect(parseCsv('a,b\nc')).toEqual([['a', 'b'], ['c']]);
  });
});

describe('csvParser', () => {
  it('question/answer 列名（大小写不敏感）', () => {
    const rows = csvParser('Question,Answer\nQ1,A1\nQ2,A2');
    expect(rows).toEqual([
      { rowIndex: 1, question: 'Q1', answer: 'A1' },
      { rowIndex: 2, question: 'Q2', answer: 'A2' },
    ]);
  });
  it('Q/A 缩写列名也认', () => {
    const rows = csvParser('q,a\nx,y');
    expect(rows).toEqual([{ rowIndex: 1, question: 'x', answer: 'y' }]);
  });
  it('缺 answer 列 → MissingColumnError', () => {
    expect(() => csvParser('question,foo\nx,y')).toThrow(MissingColumnError);
  });
  it('全空行跳过，rowIndex 保持原始行号', () => {
    const rows = csvParser('q,a\n,\nx,y');
    expect(rows).toEqual([{ rowIndex: 2, question: 'x', answer: 'y' }]);
  });
});

describe('jsonlParser', () => {
  it('逐行 JSON 对象', () => {
    const rows = jsonlParser('{"question":"Q1","answer":"A1"}\n{"question":"Q2","answer":"A2"}');
    expect(rows).toEqual([
      { rowIndex: 1, question: 'Q1', answer: 'A1' },
      { rowIndex: 2, question: 'Q2', answer: 'A2' },
    ]);
  });
  it('坏 JSON 行 → SyntaxError', async () => {
    await expect(parseImport('application/jsonl', Buffer.from(
      '{"question":"Q1","answer":"A1"}\nnot-json', 'utf8')))
      .rejects.toBeInstanceOf(SyntaxError);
  });
  it('非对象行 → SyntaxError', async () => {
    await expect(parseImport('application/jsonl', Buffer.from('[1,2]', 'utf8')))
      .rejects.toBeInstanceOf(SyntaxError);
  });
  it('缺列 → MissingColumnError', async () => {
    await expect(parseImport('application/jsonl', Buffer.from('{"foo":"x"}', 'utf8')))
      .rejects.toBeInstanceOf(MissingColumnError);
  });
  it('Q/A 缩写列名也认', () => {
    const rows = jsonlParser('{"q":"x","a":"y"}');
    expect(rows).toEqual([{ rowIndex: 1, question: 'x', answer: 'y' }]);
  });
  it('空行跳过，rowIndex 保持行号', () => {
    const rows = jsonlParser('\n{"question":"Q1","answer":"A1"}');
    expect(rows).toEqual([{ rowIndex: 2, question: 'Q1', answer: 'A1' }]);
  });
});

describe('txtParser', () => {
  it('Q:/A: 标记，A 可跨多行', () => {
    const rows = txtParser('Q: 怎么退货？\nA: 第一步\n第二步\nQ: 下一个问题\nA: 答案');
    expect(rows).toEqual([
      { rowIndex: 1, question: '怎么退货？', answer: '第一步\n第二步' },
      { rowIndex: 4, question: '下一个问题', answer: '答案' },
    ]);
  });
  it('无标记 → MissingColumnError', () => {
    expect(() => txtParser('随便写点东西')).toThrow(MissingColumnError);
  });
  it('A: 后到 EOF 都算 answer', () => {
    const rows = txtParser('Q: q\nA: a1\n尾巴行');
    expect(rows).toEqual([{ rowIndex: 1, question: 'q', answer: 'a1\n尾巴行' }]);
  });
});

describe('pickParser / MIME 字典', () => {
  it('4 种 kind 都在字典里', () => {
    expect(Object.values(MIME_PARSERS)).toEqual(expect.arrayContaining(['csv', 'jsonl', 'txt', 'xlsx']));
  });
  it('text/csv → csv', () => expect(pickParser('text/csv')).toBe('csv'));
  it('text/plain → txt', () => expect(pickParser('text/plain')).toBe('txt'));
  it('application/jsonl → jsonl', () => expect(pickParser('application/jsonl')).toBe('jsonl'));
  it('xlsx 官方 MIME → xlsx', () =>
    expect(pickParser('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx'));
  it('未知 MIME → UnsupportedFormatError（spec: 415）', () => {
    expect(() => pickParser('application/msword')).toThrow(UnsupportedFormatError);
  });
});

describe('parseImport 统一入口', () => {
  it('CSV happy path', async () => {
    const rows = await parseImport('text/csv', Buffer.from('question,answer\nQ1,A1', 'utf8'));
    expect(rows).toEqual([{ rowIndex: 1, question: 'Q1', answer: 'A1' }]);
  });
  it('JSONL happy path', async () => {
    const rows = await parseImport('application/jsonl', Buffer.from('{"question":"Q","answer":"A"}', 'utf8'));
    expect(rows).toEqual([{ rowIndex: 1, question: 'Q', answer: 'A' }]);
  });
  it('TXT happy path', async () => {
    const rows = await parseImport('text/plain', Buffer.from('Q: q\nA: a', 'utf8'));
    expect(rows).toEqual([{ rowIndex: 1, question: 'q', answer: 'a' }]);
  });
  it('未知 MIME 抛 UnsupportedFormatError', async () => {
    await expect(parseImport('video/mp4', Buffer.from('x'))).rejects.toThrow(UnsupportedFormatError);
  });
});

describe('xlsxParser（exceljs）', () => {
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  async function buildXlsx(header: string[], dataRows: string[][]): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Sheet1');
    sheet.addRow(header);
    for (const r of dataRows) sheet.addRow(r);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }

  it('正常两行数据（question/answer 列）', async () => {
    const buf = await buildXlsx(['Question', 'Answer'], [['Q1', 'A1'], ['Q2', 'A2']]);
    const rows = await parseImport(XLSX_MIME, buf);
    expect(rows).toEqual([
      { rowIndex: 2, question: 'Q1', answer: 'A1' },
      { rowIndex: 3, question: 'Q2', answer: 'A2' },
    ]);
  });
  it('缺 answer 列 → MissingColumnError', async () => {
    const buf = await buildXlsx(['Question', 'foo'], [['Q1', 'x']]);
    await expect(parseImport(XLSX_MIME, buf)).rejects.toThrow(MissingColumnError);
  });
  it('中间全空行不影响 rowIndex 连续（用真实 sheet 行号）', async () => {
    const buf = await buildXlsx(['q', 'a'], [['Q1', 'A1'], ['', ''], ['Q2', 'A2']]);
    const rows = await parseImport(XLSX_MIME, buf);
    expect(rows).toEqual([
      { rowIndex: 2, question: 'Q1', answer: 'A1' },
      { rowIndex: 4, question: 'Q2', answer: 'A2' },
    ]);
  });
});
