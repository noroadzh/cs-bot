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
  | 'rejected';

export interface ImportJob {
  id: string;
  name: string;
  sourceFilename: string;
  sourceHash: string;
  status: ImportJobStatus;
  itemCount: number;
  parseError: string | null;
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

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'needs-fix';

export interface ImportItem {
  id: string;
  jobId: string;
  question: string;
  answerRaw: string;
  answerRedacted: string;
  sensitiveFlags: string[];
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  reviewerNote: string | null;
  createdAt: string;
}

/**
 * Status terminal states — once reached, no further automatic transitions.
 * approved/partial/rejected only set by review flow.
 */
export const TERMINAL_JOB_STATUSES: ReadonlySet<ImportJobStatus> = new Set([
  'approved', 'partial', 'rejected', 'failed',
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
  page?: number;
  pageSize?: number;
}

/**
 * ImportItemListQuery - listItems query
 */
export interface ImportItemListQuery {
  status?: ReviewStatus;
  page?: number;
  pageSize?: number;
}
