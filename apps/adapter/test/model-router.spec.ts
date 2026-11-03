import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ModelRouterService } from '../src/qa/model-router.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('ModelRouterService', () => {
  beforeEach(() => setConfig({ MODEL_CATALOG_JSON: '[]' }));
  afterEach(() => resetConfig());

  it('primary 失败时 pickFallback 选次选', () => {
    const router = new ModelRouterService({} as any);
    router.register({ id: 'a', name: 'primary', baseUrl: 'http://a', latencyMs: 10 });
    router.register({ id: 'b', name: 'secondary', baseUrl: 'http://b', latencyMs: 20 });
    expect(router.pick('latency')?.id).toBe('a');
    expect(router.pickFallback('a')?.id).toBe('b');
  });

  it('微调产物登记进目录', () => {
    const router = new ModelRouterService({} as any);
    router.register({
      id: 'lora-1',
      name: 'cs-lora',
      baseUrl: 's3://art/lora-1',
      kind: 'lora',
      artifactUri: 's3://art/lora-1',
    });
    expect(router.list().some((m) => m.id === 'lora-1' && m.kind === 'lora')).toBe(true);
  });
});
