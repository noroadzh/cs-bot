/**
 * Model providers — 增项 D 的 OpenAI 兼容通道实现与路由装配
 *
 * 本地 vLLM/Ollama 与云端 LLM 都暴露 OpenAI 兼容端点，
 * 这里统一成 ModelRouter 需要的 ChatProvider。
 */
import axios, { type AxiosInstance } from 'axios';
import { ConfigService } from '../config/config.service.js';
import { ModelRouter, type ChatProvider, type ModelMode } from './model-router.js';
import { llmSemaphore } from '../common/semaphore.js';

export interface ChatProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

function completionPath(baseUrl: string): string {
  return /\/v\d+$/.test(baseUrl.replace(/\/$/, '')) ? '/chat/completions' : '/v1/chat/completions';
}

export function createHttpChatProvider(opts: ChatProviderOptions): ChatProvider {
  const api: AxiosInstance = axios.create({
    baseURL: opts.baseUrl,
    timeout: opts.timeoutMs,
    headers: opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : undefined,
  });
  const path = completionPath(opts.baseUrl);
  return {
    async chat(prompt: string): Promise<string> {
      const resp = await llmSemaphore().run(() => api.post(path, {
        model: opts.model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }));
      const text = resp.data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.trim() === '') {
        throw new Error('empty completion from model provider');
      }
      return text;
    },
  };
}

/**
 * 按 MODEL_MODE 构造路由器；cloud 模式返回 null（沿用既有 FastGPT 引擎）。
 * 配置校验（local/hybrid 必须有本地端点）由 config schema 的 superRefine 保证。
 */
export function buildModelRouter(cfg = ConfigService.instance): ModelRouter | null {
  const mode = (cfg.MODEL_MODE ?? 'cloud') as ModelMode;
  if (!mode || mode === 'cloud') return null;

  const local = createHttpChatProvider({
    baseUrl: cfg.LOCAL_LLM_BASE_URL,
    apiKey: cfg.LOCAL_LLM_API_KEY ?? '',
    model: cfg.LOCAL_LLM_MODEL || 'local-model',
    timeoutMs: cfg.LOCAL_LLM_TIMEOUT_MS ?? 25_000,
  });
  const cloud = createHttpChatProvider({
    baseUrl: cfg.LLM_PRIMARY_BASE_URL,
    apiKey: cfg.LLM_PRIMARY_API_KEY,
    model: cfg.LLM_PRIMARY_MODEL || 'deepseek-chat',
    timeoutMs: cfg.LLM_TIMEOUT_MS,
  });
  return new ModelRouter(mode, local, cloud);
}
