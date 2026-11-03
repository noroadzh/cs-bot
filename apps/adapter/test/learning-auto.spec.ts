import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { LearningService } from '../src/learning/learning.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('LearningService auto-learning', () => {
  afterEach(() => resetConfig());

  it('默认关闭：有答案也不自动入库', async () => {
    setConfig({ AUTO_LEARNING_ENABLED: false });
    const knowledge = { ingestQa: jest.fn(async () => ({ datasetId: 'd', ids: ['1'] })) };
    const svc = new LearningService(knowledge as any);
    const clusters = svc.cluster(['怎么退款', '怎么退款啊', '怎么退款呢']);
    const res = await svc.suggestAndMaybeIngest(clusters, { [clusters[0].key]: '按订单退款' });
    expect(svc.isAutoLearningEnabled()).toBe(false);
    expect(res.ingested).toBe(0);
    expect(knowledge.ingestQa).not.toHaveBeenCalled();
  });

  it('开启后低风险自动入库并写审计', async () => {
    setConfig({ AUTO_LEARNING_ENABLED: true });
    const knowledge = { ingestQa: jest.fn(async () => ({ datasetId: 'd', ids: ['1'] })) };
    const svc = new LearningService(knowledge as any);
    const clusters = svc.cluster(['怎么退款', '怎么退款啊', '怎么退款呢']);
    expect(clusters[0].risk).toBe('low');
    const res = await svc.suggestAndMaybeIngest(clusters, { [clusters[0].key]: '按订单退款' });
    expect(res.ingested).toBe(1);
    expect(knowledge.ingestQa).toHaveBeenCalled();
    expect(svc.getAudit().length).toBe(1);
  });
});
