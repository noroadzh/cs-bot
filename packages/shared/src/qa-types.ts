import type { Result } from './result.js';

export interface QAHistory { role: 'user' | 'assistant'; content: string; }

export interface AskReq {
  question: string;
  history?: QAHistory[];
  datasetIds?: string[];
  traceId: string;
}

export interface AskResp {
  answer: string;
  quotes?: Array<{ id: string; content: string; score: number }>;
  score: number;
  /** Which LLM served the answer. Omitted means unknown / mock. */
  source?: 'primary' | 'fallback';
}

export type AskResult = Result<AskResp, { code: number; message: string }>;

/** DI token used by NestJS provider config (provide / inject) */
export const IQA_ENGINE = Symbol('IQAEngine');

export interface IQAEngine {
  readonly mode: string;
  ask(req: AskReq): Promise<AskResult>;
}
