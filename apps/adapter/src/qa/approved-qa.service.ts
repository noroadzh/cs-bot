/**
 * Approved QA 检索服务
 *
 * 从 approved_qa 表检索已审核通过的问答对。
 * 供 FastGPTQaEngine 在主检索失败时 fallback 使用。
 */
import { Injectable, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

export interface ApprovedQa {
  id: string;
  question: string;
  answer: string;
  sourceJobId: string;
  sourceItemId: string;
  createdAt: Date;
}

@Injectable()
export class ApprovedQaService {
  private readonly logger = new AppLogger('ApprovedQaService');
  private readonly pool: Pool;

  constructor(@Optional() pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  /**
   * 模糊匹配问题文本，返回最相似的一条。
   * 简单实现：LIKE %question% 全文检索。
   */
  async search(question: string): Promise<ApprovedQa | null> {
    if (!question || question.trim().length < 2) return null;
    try {
      // 简单模糊匹配，按 created_at 倒序取最新匹配
      const res = await this.pool.query<ApprovedQa>(
        `SELECT id, question, answer, source_job_id as "sourceJobId",
                source_item_id as "sourceItemId", created_at as "createdAt"
         FROM approved_qa
         WHERE question ILIKE $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [`%${question.trim()}%`],
      );
      return res.rows[0] ?? null;
    } catch (err) {
      this.logger.error({ err: (err as Error).message, detail: 'approved-qa-search-failed' });
      return null;
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}