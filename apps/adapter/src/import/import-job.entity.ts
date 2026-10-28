/**
 * Import job entity (DB row → object)
 * 状态机（spec M10 §1.3）：
 *   uploaded → parsing → parsed → {approved | partial | rejected}
 *   ↑                       ↘ failed（解析失败后终态）
 */
export type ImportJobStatus =
  | 'uploaded'
  | 'parsing'
  | 'parsed'
  | 'failed'
  | 'approved'
  | 'partial'
  | 'rejected'
  | 'rolled_back';

export interface ImportJob {
  id: string;
  name: string;
  sourceFilename: string;
  sourceHash: string;
  status: ImportJobStatus;
  itemCount: number;
  parseError: string | null;
  /** 阶段计数（re-pipeline） */
  cleanedCount: number;
  pairedCount: number;
  unpairedCount: number;
  totalMessages: number;
  parsedMessages: number;
  maskedCount: number;
  blockedCount: number;
  dedupCount: number;
  approvedCount: number;
  importedCount: number;
  failedCount: number;
  /** approved 条目写入的 FastGPT 数据集名 */
  datasetName: string | null;
  sourceShape: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 内部行视图：含落盘路径与 MIME，**仅 service / controller 入参解析时使用**，
 * 不出 DTO、不入 API 响应。客户端拿到 storedPath 即可让解析器读盘 = 任意文件读取。
 */
export interface ImportJobRow extends ImportJob {
  storedPath: string | null;
  mimeType: string | null;
}

export type ReviewStatus = 'pending' | 'approved' | 'modified' | 'rejected' | 'needs-fix';

export interface ImportItem {
  id: string;
  jobId: string;
  question: string;
  answerRaw: string;
  answerRedacted: string;
  /** 条目级幂等键（丢弃条目清空正文后仍保留） */
  sourceHash: string | null;
  sessionHash: string | null;
  occurredAt: string | null;
  sensitiveFlags: string[];
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  reviewerNote: string | null;
  /** 写入 FastGPT 数据集后的 qa id */
  importedQaId: string | null;
  /** 命中入库黑名单，不可批量通过 */
  autoBlocked: boolean;
  /** 近似已有 QA 的 id（score ≥ 0.9） */
  similarQaId: string | null;
  /** keep / discard 建议 */
  suggestAction: string | null;
  createdAt: string;
}

/**
 * Status terminal states — once reached, no further automatic transitions.
 * approved/partial/rejected only set by review flow.
 */
export const TERMINAL_JOB_STATUSES: ReadonlySet<ImportJobStatus> = new Set([
  'approved', 'partial', 'rejected', 'rolled_back', 'failed',
]);

/**
 * ReviewItemInput - reviewItem 入参
 */
export interface ReviewItemInput {
  itemId: string;
  status: ReviewStatus;
  redactedAnswer?: string;
}

/**
 * ApproveAllInput - approveAll 入参
 */
export interface ApproveAllInput {
  overwriteApproved?: boolean;
}

/**
 * ImportJobListQuery - listJobs query
 */
export interface ImportJobListQuery {
  status?: ImportJobStatus;
  /** 默认 50，上限 200 */
  limit?: number;
  offset?: number;
}

/**
 * ImportItemListQuery - listItems query
 */
export interface ImportItemListQuery {
  reviewStatus?: ReviewStatus;
  /** true = 仅含敏感命中（sensitive_flags 非空）；false = 仅不含 */
  sensitive?: boolean;
  limit?: number;
  offset?: number;
}

export interface ImportJobPage {
  items: ImportJob[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImportItemPage {
  items: ImportItem[];
  total: number;
  limit: number;
  offset: number;
}

/** 详情视图：job 概要 + 审核分布 + 能否删除 */
export interface ImportJobDetail {
  job: ImportJob;
  itemCounts: Record<ReviewStatus, number>;
  deletable: boolean;
}

/** 建 job 后需带回调用方的运行时信息（不入库） */
export interface ImportJobCreated {
  job: ImportJob;
  reused: boolean;
  storedPath: string;
  mimeType: string;
}

export interface CreateFromFileInput {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  name?: string;
}
