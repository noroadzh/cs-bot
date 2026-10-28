/**
 * 导入实体映射与纯函数辅助
 */
import { extname } from 'path';
import type {
  ImportJob,
  ImportJobRow,
  ImportJobStatus,
  ImportItem,
  ReviewStatus,
} from './import-job.entity.js';

export const DELETABLE_STATUSES: readonly ImportJobStatus[] = [
  'uploaded', 'parsing', 'parsed', 'failed',
];

export function mapJobRow(row: Record<string, unknown>): ImportJobRow {
  return {
    ...mapJob(row),
    storedPath: row.stored_path === null || row.stored_path === undefined ? null : String(row.stored_path),
    mimeType: row.mime_type === null || row.mime_type === undefined ? null : String(row.mime_type),
  };
}

export function mapJob(row: Record<string, unknown>): ImportJob {
  return {
    id: String(row.id),
    name: String(row.name),
    sourceFilename: String(row.source_filename),
    sourceHash: String(row.source_hash),
    status: row.status as ImportJobStatus,
    itemCount: Number(row.item_count ?? 0),
    parseError: row.parse_error === null || row.parse_error === undefined ? null : String(row.parse_error),
    cleanedCount: Number(row.cleaned_count ?? 0),
    pairedCount: Number(row.paired_count ?? 0),
    unpairedCount: Number(row.unpaired_count ?? 0),
    totalMessages: Number(row.total_msgs ?? 0),
    parsedMessages: Number(row.parsed_msgs ?? 0),
    maskedCount: Number(row.masked_count ?? 0),
    blockedCount: Number(row.blocked_count ?? 0),
    dedupCount: Number(row.dedup_count ?? 0),
    approvedCount: Number(row.approved_count ?? 0),
    importedCount: Number(row.imported_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    datasetName: row.dataset_name == null ? null : String(row.dataset_name),
    datasetId: row.dataset_id == null ? null : String(row.dataset_id),
    sourceShape: row.source_shape == null ? null : String(row.source_shape),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/** 行视图 → DTO：剥掉 storedPath / mimeType，落盘路径永不出内网 API。 */
export function toJobDto(row: ImportJobRow): ImportJob {
  const { storedPath: _s, mimeType: _m, ...dto } = row;
  return dto;
}

export function mapItem(row: Record<string, unknown> | undefined): ImportItem {
  if (!row) {
    return {
      id: '', jobId: '', question: '', answerRaw: '', answerRedacted: '',
      sourceHash: null, sessionHash: null, occurredAt: null,
      sensitiveFlags: [], reviewStatus: 'pending', reviewedAt: null,
      reviewerNote: null, importedQaId: null, autoBlocked: false,
      similarQaId: null, suggestAction: null, createdAt: '',
    };
  }
  const flags = row.sensitive_flags;
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    question: row.question == null ? '' : String(row.question),
    answerRaw: row.answer_raw == null ? '' : String(row.answer_raw),
    answerRedacted: row.answer_redacted == null ? '' : String(row.answer_redacted),
    sourceHash: row.source_hash == null ? null : String(row.source_hash),
    sessionHash: row.session_hash == null ? null : String(row.session_hash),
    occurredAt: row.occurred_at == null ? null : new Date(row.occurred_at as string).toISOString(),
    sensitiveFlags: Array.isArray(flags) ? flags.map(String) : [],
    reviewStatus: row.review_status as ImportItem['reviewStatus'],
    reviewedAt: row.reviewed_at == null ? null : new Date(row.reviewed_at as string).toISOString(),
    reviewerNote: row.reviewer_note == null ? null : String(row.reviewer_note),
    importedQaId: row.imported_qa_id == null ? null : String(row.imported_qa_id),
    autoBlocked: row.auto_blocked === true,
    similarQaId: row.similar_qa_id == null ? null : String(row.similar_qa_id),
    suggestAction: row.suggest_action == null ? null : String(row.suggest_action),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export function aggregateStatus(counts: Record<ReviewStatus, number>): ImportJobStatus | null {
  const pending = counts.pending;
  const nf = counts['needs-fix'];
  if (pending > 0 || nf > 0) return null;
  const approved = counts.approved + (counts.modified ?? 0);
  const rejected = counts.rejected;
  if (approved > 0 && rejected > 0) return 'partial';
  if (approved > 0) return 'approved';
  if (rejected > 0) return 'rejected';
  return 'parsed';
}

/** UPDATE 的受影响行数：优先驱动给的 rowCount/affectedRows，退化到 rows.length */
export function affectedCount(res: {
  rowCount?: number | null;
  rows: Record<string, unknown>[];
}): number {
  if (typeof res.rowCount === 'number') return res.rowCount;
  const first = res.rows[0] as { affectedRows?: number } | undefined;
  if (first && typeof first.affectedRows === 'number') return first.affectedRows;
  return res.rows.length;
}

export function isDeletable(status: ImportJobStatus): boolean {
  return DELETABLE_STATUSES.includes(status);
}

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}

export function emptyStatusCounts(): Record<ImportJobStatus, number> {
  return {
    uploaded: 0, parsing: 0, parsed: 0, failed: 0,
    approved: 0, partial: 0, rejected: 0, rolled_back: 0,
  };
}

const EXT_MIME: Readonly<Record<string, string>> = {
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.json': 'application/jsonl',
  '.jsonl': 'application/jsonl',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function mimeFromExtension(filename: string): string {
  return EXT_MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

/** 真实 MIME 优先；octet-stream/空时按扩展名推断，并去掉 charset 后缀 */
export function resolveMimeType(mimeType: string, filename: string): string {
  const m = (mimeType ?? '').toLowerCase().trim();
  if (m === '' || m === 'application/octet-stream' || m === 'binary/octet-stream') {
    return mimeFromExtension(filename);
  }
  return m.split(';')[0].trim();
}

export function filenameFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop();
    return seg === undefined ? '' : decodeURIComponent(seg);
  } catch {
    return '';
  }
}
