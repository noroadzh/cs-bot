/**
 * ReviewManifest — 审核清单 review.xlsx（概设 §5 M10 步骤 8）
 *
 * 列：序号 / 会话哈希 / 发生时间 / 问题 / 答案 / 脱敏标记 / 敏感标记 / 近似已有 / 建议动作 / 审核结果
 * 清单内容已脱敏（answer 用 answer_redacted）。
 */

export interface ManifestRow {
  index: number;
  conversationHash: string;
  occurredAt: string;
  question: string;
  answer: string;
  redacted: boolean;
  sensitive: boolean;
  similar: boolean;
  suggestAction: string;
  reviewResult: string;
}

export async function buildReviewManifest(rows: readonly ManifestRow[]): Promise<Buffer> {
  // 动态导入 exceljs（与 import-parser 一致：避免测试/启动期加载 tmp 的副作用）
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('审核清单');
  ws.columns = [
    { header: '序号', key: 'index', width: 8 },
    { header: '会话哈希', key: 'conversationHash', width: 20 },
    { header: '发生时间', key: 'occurredAt', width: 22 },
    { header: '问题', key: 'question', width: 40 },
    { header: '答案', key: 'answer', width: 50 },
    { header: '脱敏标记', key: 'redacted', width: 10 },
    { header: '敏感标记', key: 'sensitive', width: 10 },
    { header: '近似已有', key: 'similar', width: 10 },
    { header: '建议动作', key: 'suggestAction', width: 14 },
    { header: '审核结果', key: 'reviewResult', width: 14 },
  ];
  for (const r of rows) {
    ws.addRow({
      index: r.index,
      conversationHash: r.conversationHash,
      occurredAt: r.occurredAt,
      question: r.question,
      answer: r.answer,
      redacted: r.redacted ? '是' : '否',
      sensitive: r.sensitive ? '是' : '否',
      similar: r.similar ? '是' : '否',
      suggestAction: r.suggestAction,
      reviewResult: r.reviewResult,
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
