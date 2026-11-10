#!/usr/bin/env node
/**
 * Jest 在同时配置 global + 路径 coverageThreshold 时会把 global 算偏
 * （表内 All files 与 threshold 数字不一致）。此处用 json-summary 的 total 做全局门禁。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const summaryPath = join(root, 'coverage', 'coverage-summary.json');

const thresholds = {
  statements: 75,
  branches: 60,
  functions: 70,
  lines: 75,
};

if (!existsSync(summaryPath)) {
  console.error(`missing ${summaryPath}`);
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const total = summary.total;
if (!total) {
  console.error('coverage-summary.json missing total');
  process.exit(1);
}

let failed = false;
for (const [metric, min] of Object.entries(thresholds)) {
  const pct = total[metric]?.pct;
  if (typeof pct !== 'number' || Number.isNaN(pct)) {
    console.error(`global ${metric}: missing pct`);
    failed = true;
    continue;
  }
  if (pct < min) {
    console.error(`global ${metric} ${pct}% < ${min}%`);
    failed = true;
  } else {
    console.log(`global ${metric} ${pct}% >= ${min}%`);
  }
}

process.exit(failed ? 1 : 0);
