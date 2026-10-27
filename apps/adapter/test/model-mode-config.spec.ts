/**
 * MODEL_MODE 配置校验（local/hybrid 需本地端点；cloud 默认）
 */
import { describe, it, expect } from '@jest/globals';
import { AppConfigSchema } from '../src/config/config.schema.js';

describe('MODEL_MODE config', () => {
  it('local/hybrid 缺 LOCAL_LLM_BASE_URL → 拒绝', () => {
    for (const mode of ['local', 'hybrid']) {
      const r = AppConfigSchema.safeParse({ ...process.env, MODEL_MODE: mode, LOCAL_LLM_BASE_URL: '' });
      expect(r.success).toBe(false);
    }
  });

  it('local + 本地端点 → 通过', () => {
    const r = AppConfigSchema.safeParse({
      ...process.env,
      MODEL_MODE: 'local',
      LOCAL_LLM_BASE_URL: 'http://vllm:8000/v1',
    });
    expect(r.success).toBe(true);
  });
});
