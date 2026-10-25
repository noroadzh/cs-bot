/**
 * ContentSniffer — 上传内容形态嗅探（概设 §5 M10 步骤 1）
 *
 * 识别：企微会话存档 JSON（message 数组）/ 三列表（时间,说话方,内容）/ 直接成对 QA。
 * 未识别 → 抛 UnrecognizedShapeError（调用方转 415）。
 */
import { parseCsv } from './import-parser.js';

export type ImportShape = 'wecom-archive' | 'conversation-table' | 'qa-pairs';

export class UnrecognizedShapeError extends Error {
  readonly code = 'IMPORT_UNRECOGNIZED_SHAPE';
  constructor(detail: string) {
    super(detail);
    this.name = 'UnrecognizedShapeError';
  }
}

function isArchiveMessage(m: unknown): boolean {
  if (m === null || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  const hasContent = 'content' in o || 'text' in o || 'Content' in o;
  const hasSender = 'sender' in o || 'senderId' in o || 'from' in o || 'FromUserName' in o;
  return hasContent && hasSender;
}

function isConversationHeader(header: readonly string[] | undefined): boolean {
  if (!header) return false;
  const n = header.map((h) => h.trim());
  const hasTime = n.includes('时间') || n.includes('发生时间');
  const hasSender = n.includes('说话方') || n.includes('发送方') || n.includes('发言人');
  const hasContent = n.includes('内容') || n.includes('消息内容');
  return hasTime && hasSender && hasContent;
}

/**
 * 嗅探上传文件的内容形态。
 * @param bytes 文件字节
 * @param mimeType 归一后的 MIME
 * @param firstSheetHeader XLSX 首行（由调用方用 exceljs 读出；CSV/JSON 可不传）
 */
export async function sniffShape(
  bytes: Buffer,
  mimeType: string,
  firstSheetHeader?: readonly string[],
): Promise<ImportShape> {
  if (mimeType.includes('json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new UnrecognizedShapeError('invalid JSON');
    }
    if (Array.isArray(parsed)) {
      if (parsed.some(isArchiveMessage)) return 'wecom-archive';
      // 数组元素为 {question,answer} → 直接成对
      if (parsed.some((e) => e && typeof e === 'object' && ('question' in e || 'q' in e))) {
        return 'qa-pairs';
      }
      throw new UnrecognizedShapeError('JSON array is neither archive nor QA pairs');
    }
    throw new UnrecognizedShapeError('JSON is not an array');
  }

  if (mimeType === 'text/csv') {
    const rows = parseCsv(bytes.toString('utf8'));
    if (isConversationHeader(rows[0])) return 'conversation-table';
    return 'qa-pairs';
  }

  if (mimeType.includes('spreadsheetml')) {
    if (firstSheetHeader && isConversationHeader(firstSheetHeader)) return 'conversation-table';
    return 'qa-pairs';
  }

  // txt / 其他：按直接成对处理
  return 'qa-pairs';
}
