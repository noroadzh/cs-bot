/**
 * 导入去重键与元数据哈希
 *
 * source_hash = sha256(NFKC(q).trim().collapse + "\n" + NFKC(a).trim().collapse)
 * 保留大小写（中文语义不受影响，英文问句大小写可能有意），仅做不可见差异归一。
 */
import { createHash } from 'node:crypto';

export function normalizePairText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function computeSourceHash(question: string, answer: string): string {
  return createHash('sha256')
    .update(`${normalizePairText(question)}\n${normalizePairText(answer)}`)
    .digest('hex');
}

/** 会话标识不可逆哈希（32 hex），空会话返回 null */
export function computeSessionHash(conversationId: string | null | undefined): string | null {
  const id = conversationId?.trim();
  if (!id) return null;
  return createHash('sha256').update(id).digest('hex').slice(0, 32);
}
