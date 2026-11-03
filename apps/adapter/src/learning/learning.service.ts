/**
 * 学习闭环：未命中聚类建议 + 可开关零审核自动入库
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { KnowledgeService } from '../admin/knowledge.service.js';
import { AppLogger } from '../common/logger.js';

export interface MissCluster {
  key: string;
  questions: string[];
  suggestedAnswer?: string;
  risk: 'low' | 'high';
}

@Injectable()
export class LearningService {
  private readonly logger = new AppLogger('LearningService');
  private readonly audit: Array<Record<string, unknown>> = [];

  constructor(private readonly knowledge: KnowledgeService) {}

  isAutoLearningEnabled(): boolean {
    return Boolean(ConfigService.instance.AUTO_LEARNING_ENABLED);
  }

  /** 简易同义归并：按规范化问题前缀聚类 */
  cluster(questions: readonly string[]): MissCluster[] {
    const map = new Map<string, string[]>();
    for (const q of questions) {
      // 取规范化前缀做同义归并（短前缀可把「怎么退款/怎么退款啊」归为一簇）
      const key = q.trim().toLowerCase().replace(/\s+/g, '').slice(0, 4) || '_empty';
      const list = map.get(key) ?? [];
      list.push(q);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, qs]) => ({
      key,
      questions: qs,
      risk: qs.length >= 3 ? ('low' as const) : ('high' as const),
    }));
  }

  async suggestAndMaybeIngest(
    clusters: MissCluster[],
    answers: Record<string, string>,
  ): Promise<{ ingested: number; queued: number }> {
    let ingested = 0;
    let queued = 0;
    const auto = this.isAutoLearningEnabled();
    for (const c of clusters) {
      const answer = answers[c.key]?.trim();
      if (!answer) {
        queued += 1;
        continue;
      }
      c.suggestedAnswer = answer;
      if (auto && c.risk === 'low') {
        await this.knowledge.ingestQa([{ question: c.questions[0], answer }]);
        this.audit.push({
          at: new Date().toISOString(),
          action: 'auto-learn',
          key: c.key,
          question: c.questions[0],
        });
        ingested += 1;
      } else {
        queued += 1;
      }
    }
    this.logger.log({ detail: 'learning-pass', ingested, queued, auto });
    return { ingested, queued };
  }

  getAudit(): readonly Record<string, unknown>[] {
    return this.audit;
  }
}
