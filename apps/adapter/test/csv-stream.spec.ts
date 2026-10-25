/**
 * M10 1.3：CSV 逐行流式解析 + 大文件内存约束验证
 */
import { describe, it, expect } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCsvLine, parseCsvFileStream } from '../src/import/csv-stream.js';

describe('parseCsvLine', () => {
  it('解析普通行与引号转义', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(parseCsvLine('"a,1",b')).toEqual(['a,1', 'b']);
    expect(parseCsvLine('"he said ""hi""",x')).toEqual(['he said "hi"', 'x']);
  });
});

describe('parseCsvFileStream 大文件', () => {
  it('逐行解析 5 万行 CSV，结果正确且不整体驻留', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'csv-stream-'));
    const file = join(dir, 'big.csv');
    const N = 50_000;
    const lines = ['question,answer'];
    for (let i = 0; i < N; i++) lines.push(`问题${i},答案${i}`);
    await fs.writeFile(file, lines.join('\n'), 'utf8');

    const before = process.memoryUsage().heapUsed;
    const rows = await parseCsvFileStream(file);
    const after = process.memoryUsage().heapUsed;

    expect(rows).toHaveLength(N);
    expect(rows[0]).toEqual({ rowIndex: 2, question: '问题0', answer: '答案0' });
    expect(rows[N - 1].question).toBe(`问题${N - 1}`);
    // 内存增量宽松上限（逐行累积结果本身约数 MB；避免整体文件副本导致翻倍）
    const deltaMb = (after - before) / (1024 * 1024);
    expect(deltaMb).toBeLessThan(200);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
