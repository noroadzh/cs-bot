/**
 * 学习闭环：未命中聚类建议 + 可开关零审核自动入库 + 审计持久化
 */
import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { KnowledgeService } from '../admin/knowledge.service.js';
import { AppLogger } from '../common/logger.js';
import { currentTenantId } from '../common/tenant-scope.js';

export interface MissCluster {
  key: string;
  questions: string[];
  suggestedAnswer?: string;
  risk: 'low' | 'high';
  status?: 'queued' | 'ingested';
}

const HIGH_RISK_HINT =
  /密码|身份证|银行卡|验证码|转账|私下|加微|微信红包|色情|赌博/i;

@Injectable()
export class LearningService implements OnModuleDestroy {
  private readonly logger = new AppLogger('LearningService');
  private readonly memoryAudit: Array<Record<string, unknown>> = [];
  private lastQueue: MissCluster[] = [];
  private readonly pool: Pool;

  constructor(
    private readonly knowledge: KnowledgeService,
    @Optional() pool?: Pool,
  ) {
    this.pool =
      pool ??
      new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 3 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  isAutoLearningEnabled(): boolean {
    return Boolean(ConfigService.instance.AUTO_LEARNING_ENABLED);
  }

  /** 简易同义归并：按规范化问题前缀聚类；含敏感词或样本过少 → high */
  cluster(questions: readonly string[]): MissCluster[] {
    const map = new Map<string, string[]>();
    for (const q of questions) {
      const key = q.trim().toLowerCase().replace(/\s+/g, '').slice(0, 4) || '_empty';
      const list = map.get(key) ?? [];
      list.push(q);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, qs]) => {
      const risky = qs.some((q) => HIGH_RISK_HINT.test(q));
      return {
        key,
        questions: qs,
        risk: risky || qs.length < 3 ? ('high' as const) : ('low' as const),
        status: 'queued' as const,
        suggestedAnswer: this.draftAnswer(qs),
      };
    });
  }

  draftAnswer(questions: readonly string[]): string {
    const sample = questions[0]?.trim() || '（空问题）';
    return `【建议草稿】针对「${sample.slice(0, 80)}」请补充标准答复后入库。`;
  }

  getQueue(): MissCluster[] {
    return this.lastQueue.map((c) => ({ ...c }));
  }

  async suggestAndMaybeIngest(
    clusters: MissCluster[],
    answers: Record<string, string> = {},
  ): Promise<{ ingested: number; queued: number; clusters: MissCluster[] }> {
    let ingested = 0;
    let queued = 0;
    const auto = this.isAutoLearningEnabled();
    const out: MissCluster[] = [];

    for (const c of clusters) {
      const answer = (answers[c.key] ?? c.suggestedAnswer ?? this.draftAnswer(c.questions)).trim();
      const item: MissCluster = {
        ...c,
        suggestedAnswer: answer,
        status: 'queued',
      };

      // 高风险：即使 auto 开启也不入库
      if (c.risk === 'high') {
        queued += 1;
        out.push(item);
        continue;
      }

      if (auto && answers[c.key]?.trim()) {
        await this.knowledge.ingestQa([{ question: c.questions[0], answer }]);
        await this.appendAudit({
          action: 'auto-learn',
          clusterKey: c.key,
          question: c.questions[0],
          answer,
          risk: c.risk,
        });
        item.status = 'ingested';
        ingested += 1;
      } else {
        queued += 1;
      }
      out.push(item);
    }

    this.lastQueue = out.filter((c) => c.status === 'queued');
    this.logger.log({ detail: 'learning-pass', ingested, queued, auto });
    return { ingested, queued, clusters: out };
  }

  /** 人工审核通过后入库（高风险也允许人工确认） */
  async approve(input: { key: string; answer?: string }): Promise<MissCluster> {
    const found =
      this.lastQueue.find((c) => c.key === input.key) ??
      ({ key: input.key, questions: [input.key], risk: 'high' as const, suggestedAnswer: '' });
    const answer = (input.answer ?? found.suggestedAnswer ?? this.draftAnswer(found.questions)).trim();
    if (!answer) throw new Error('answer required');
    await this.knowledge.ingestQa([{ question: found.questions[0], answer }]);
    await this.appendAudit({
      action: 'manual-approve',
      clusterKey: found.key,
      question: found.questions[0],
      answer,
      risk: found.risk,
    });
    this.lastQueue = this.lastQueue.filter((c) => c.key !== input.key);
    return { ...found, suggestedAnswer: answer, status: 'ingested' };
  }

  async getAudit(limit = 100): Promise<readonly Record<string, unknown>[]> {
    try {
      const res = await this.pool.query(
        `SELECT id, action, cluster_key AS "clusterKey", question, answer, risk, detail, created_at AS "createdAt"
           FROM learning_audit
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [currentTenantId(), Math.min(Math.max(limit, 1), 500)],
      );
      if (res.rows.length > 0) return res.rows;
    } catch (err) {
      this.logger.warn({ detail: 'learning-audit-read-fail', err: (err as Error).message });
    }
    return this.memoryAudit.slice(-limit).reverse();
  }

  private async appendAudit(row: {
    action: string;
    clusterKey: string;
    question: string;
    answer: string;
    risk: string;
  }): Promise<void> {
    const entry = {
      at: new Date().toISOString(),
      ...row,
    };
    this.memoryAudit.push(entry);
    try {
      await this.pool.query(
        `INSERT INTO learning_audit (tenant_id, action, cluster_key, question, answer, risk, detail, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now())`,
        [
          currentTenantId(),
          row.action,
          row.clusterKey,
          row.question,
          row.answer,
          row.risk,
          JSON.stringify({}),
        ],
      );
    } catch (err) {
      this.logger.warn({ detail: 'learning-audit-write-fail', err: (err as Error).message });
    }
  }
}
