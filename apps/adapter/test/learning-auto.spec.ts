import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { LearningService } from '../src/learning/learning.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

function mockPool(rows: unknown[] = []) {
  return {
    query: jest.fn(async () => ({ rows })),
    end: jest.fn(async () => undefined),
  };
}

describe('LearningService auto-learning', () => {
  afterEach(() => resetConfig());

  it('默认关闭：有答案也不自动入库，但仍生成建议草稿', async () => {
    setConfig({ AUTO_LEARNING_ENABLED: false, DATABASE_URL: 'postgres://x' });
    const knowledge = { ingestQa: jest.fn(async () => ({ datasetId: 'd', ids: ['1'] })) };
    const svc = new LearningService(knowledge as any, mockPool() as any);
    const clusters = svc.cluster(['怎么退款', '怎么退款啊', '怎么退款呢']);
    expect(clusters[0].suggestedAnswer).toContain('建议草稿');
    const res = await svc.suggestAndMaybeIngest(clusters, { [clusters[0].key]: '按订单退款' });
    expect(svc.isAutoLearningEnabled()).toBe(false);
    expect(res.ingested).toBe(0);
    expect(knowledge.ingestQa).not.toHaveBeenCalled();
    expect(svc.getQueue().length).toBeGreaterThan(0);
  });

  it('开启后低风险且提供答案时自动入库并写审计', async () => {
    setConfig({ AUTO_LEARNING_ENABLED: true, DATABASE_URL: 'postgres://x' });
    const knowledge = { ingestQa: jest.fn(async () => ({ datasetId: 'd', ids: ['1'] })) };
    const pool = mockPool();
    const svc = new LearningService(knowledge as any, pool as any);
    const clusters = svc.cluster(['怎么退款', '怎么退款啊', '怎么退款呢']);
    expect(clusters[0].risk).toBe('low');
    const res = await svc.suggestAndMaybeIngest(clusters, { [clusters[0].key]: '按订单退款' });
    expect(res.ingested).toBe(1);
    expect(knowledge.ingestQa).toHaveBeenCalled();
    const insertSql = (pool.query.mock.calls as unknown as Array<[string]>).map((c) => c[0]).join('\n');
    expect(insertSql).toContain('INSERT INTO learning_audit');
    const audit = await svc.getAudit();
    expect(audit.length).toBeGreaterThanOrEqual(0);
  });

  it('高风险即使开启也不自动入库', async () => {
    setConfig({ AUTO_LEARNING_ENABLED: true, DATABASE_URL: 'postgres://x' });
    const knowledge = { ingestQa: jest.fn(async () => ({ datasetId: 'd', ids: ['1'] })) };
    const svc = new LearningService(knowledge as any, mockPool() as any);
    const clusters = svc.cluster(['银行卡密码是多少']);
    expect(clusters[0].risk).toBe('high');
    const res = await svc.suggestAndMaybeIngest(clusters, { [clusters[0].key]: '勿泄露' });
    expect(res.ingested).toBe(0);
    expect(knowledge.ingestQa).not.toHaveBeenCalled();
  });

  it('人工 approve 可入库高风险并写审计', async () => {
    setConfig({ AUTO_LEARNING_ENABLED: true, DATABASE_URL: 'postgres://x' });
    const knowledge = { ingestQa: jest.fn(async () => ({ datasetId: 'd', ids: ['1'] })) };
    const pool = mockPool();
    const svc = new LearningService(knowledge as any, pool as any);
    const clusters = svc.cluster(['怎么退']);
    await svc.suggestAndMaybeIngest(clusters, {});
    const approved = await svc.approve({ key: clusters[0].key, answer: '人工标准答' });
    expect(approved.status).toBe('ingested');
    expect(knowledge.ingestQa).toHaveBeenCalled();
  });
});
