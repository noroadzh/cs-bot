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
}

export type AskResult = Result<AskResp, { code: number; message: string }>;

export interface IQAEngine {
  readonly mode: string;
  ask(req: AskReq): Promise<AskResult>;
}
