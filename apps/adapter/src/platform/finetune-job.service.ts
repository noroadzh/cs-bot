/**
 * LoRA 微调任务编排（控制面 PG；禁止占用问答热路径）
 */
import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { ConfigService } from '../config/config.service.js';
import { ModelRouterService } from '../qa/model-router.service.js';
import { AppLogger } from '../common/logger.js';

export type FinetuneStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface FinetuneJob {
  id: string;
  name: string;
  status: FinetuneStatus;
  baseModel?: string;
  artifactUri?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

@Injectable()
export class FinetuneJobService implements OnModuleDestroy {
  private readonly logger = new AppLogger('FinetuneJobService');
  private readonly pool: Pool;
  /** 无库时的内存兜底（单测） */
  private readonly memory = new Map<string, FinetuneJob>();

  constructor(
    private readonly router: ModelRouterService,
    @Optional() pool?: Pool,
  ) {
    this.pool =
      pool ??
      new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 3 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  async create(input: { name: string; baseModel?: string }): Promise<FinetuneJob> {
    const now = new Date().toISOString();
    const job: FinetuneJob = {
      id: randomUUID(),
      name: input.name,
      status: 'queued',
      baseModel: input.baseModel,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.pool.query(
        `INSERT INTO finetune_job (id, name, status, base_model, created_at, updated_at)
         VALUES ($1,$2,'queued',$3,now(),now())`,
        [job.id, job.name, job.baseModel ?? null],
      );
    } catch (err) {
      this.logger.warn({ detail: 'finetune-insert-fallback-memory', err: (err as Error).message });
      this.memory.set(job.id, job);
    }
    return job;
  }

  async list(limit = 50): Promise<FinetuneJob[]> {
    try {
      const res = await this.pool.query(
        `SELECT id, name, status, base_model, artifact_uri, created_at, updated_at, completed_at
           FROM finetune_job ORDER BY created_at DESC LIMIT $1`,
        [Math.min(limit, 200)],
      );
      return res.rows.map(mapRow);
    } catch {
      return [...this.memory.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }

  async get(id: string): Promise<FinetuneJob | undefined> {
    try {
      const res = await this.pool.query(
        `SELECT id, name, status, base_model, artifact_uri, created_at, updated_at, completed_at
           FROM finetune_job WHERE id = $1`,
        [id],
      );
      return res.rows[0] ? mapRow(res.rows[0]) : this.memory.get(id);
    } catch {
      return this.memory.get(id);
    }
  }

  async markRunning(id: string): Promise<FinetuneJob | undefined> {
    return this.setStatus(id, 'running');
  }

  async complete(input: {
    id: string;
    name?: string;
    artifactUri: string;
    baseUrl?: string;
  }): Promise<{ job: FinetuneJob; endpoint: ReturnType<ModelRouterService['register']> }> {
    const existing = await this.get(input.id);
    const name = input.name ?? existing?.name ?? input.id;
    const now = new Date().toISOString();
    const job: FinetuneJob = {
      id: input.id,
      name,
      status: 'succeeded',
      baseModel: existing?.baseModel,
      artifactUri: input.artifactUri,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      completedAt: now,
    };
    try {
      await this.pool.query(
        `INSERT INTO finetune_job (id, name, status, base_model, artifact_uri, created_at, updated_at, completed_at)
         VALUES ($1,$2,'succeeded',$3,$4,now(),now(),now())
         ON CONFLICT (id) DO UPDATE SET
           status = 'succeeded',
           artifact_uri = EXCLUDED.artifact_uri,
           name = EXCLUDED.name,
           updated_at = now(),
           completed_at = now()`,
        [job.id, job.name, job.baseModel ?? null, job.artifactUri],
      );
    } catch (err) {
      this.logger.warn({ detail: 'finetune-complete-memory', err: (err as Error).message });
      this.memory.set(job.id, job);
    }
    const endpoint = this.router.register({
      id: job.id,
      name: job.name,
      baseUrl: input.baseUrl ?? input.artifactUri,
      kind: 'lora',
      artifactUri: input.artifactUri,
    });
    this.logger.log({ detail: 'finetune-complete', jobId: job.id });
    return { job, endpoint };
  }

  private async setStatus(id: string, status: FinetuneStatus): Promise<FinetuneJob | undefined> {
    try {
      const res = await this.pool.query(
        `UPDATE finetune_job SET status = $2, updated_at = now() WHERE id = $1
         RETURNING id, name, status, base_model, artifact_uri, created_at, updated_at, completed_at`,
        [id, status],
      );
      if (res.rows[0]) return mapRow(res.rows[0]);
    } catch {
      /* memory */
    }
    const m = this.memory.get(id);
    if (!m) return undefined;
    m.status = status;
    m.updatedAt = new Date().toISOString();
    return m;
  }
}

function mapRow(row: Record<string, unknown>): FinetuneJob {
  return {
    id: String(row.id),
    name: String(row.name),
    status: row.status as FinetuneStatus,
    baseModel: row.base_model ? String(row.base_model) : undefined,
    artifactUri: row.artifact_uri ? String(row.artifact_uri) : undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at as string).toISOString()
      : undefined,
  };
}
