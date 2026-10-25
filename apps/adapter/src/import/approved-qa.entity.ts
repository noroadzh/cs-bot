/**
 * Approved QA entry (approved_qa 表行映射)
 *
 * 来源：import_job → import_item(review_status=approved) → approved_qa。
 * ask 路径优先检索本表，命中则直接回答案，不再走 LLM。
 * 落库时 answer 取脱敏版 answer_redacted（answer_raw 只供授权审核，不外泄）。
 */
export interface ApprovedQa {
  /** 应用层生成（与 import_job / import_item 一致，不依赖 pgcrypto） */
  id: string;
  /** 问题；UNIQUE，重复导入走 upsert 更新答案 */
  question: string;
  /** 答案（脱敏版） */
  answer: string;
  /** 来源 import_job；job 被删时置 NULL（ON DELETE SET NULL），不留孤儿知识 */
  sourceJobId: string | null;
  /** 来源 import_item */
  sourceItemId: string | null;
  createdAt: string;
}

/** 检索命中时的最小视图（只带 ask 真正要用的两个字段） */
export interface ApprovedQaMatch {
  question: string;
  answer: string;
}