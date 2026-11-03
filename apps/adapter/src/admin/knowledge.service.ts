/**
 * 知识代理：只经 FastGPTClient（R-2 / R-7），不直连 Mongo/pgvector
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { FastGPTClient } from '../qa/fastgpt.client.js';
import { AppLogger } from '../common/logger.js';

@Injectable()
export class KnowledgeService {
  private readonly logger = new AppLogger('KnowledgeService');
  private readonly client: FastGPTClient;

  constructor(_config: ConfigService) {
    const cfg = ConfigService.instance;
    this.client = new FastGPTClient({
      baseUrl: cfg.FASTGPT_BASE_URL,
      apiKey: cfg.FASTGPT_API_KEY,
      datasetIds: cfg.FASTGPT_DATASET_IDS
        ? cfg.FASTGPT_DATASET_IDS.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    });
  }

  async listCollections(): Promise<{ datasetIds: string[]; collections: Array<{ datasetId: string; count: number }> }> {
    const datasetIds = (ConfigService.instance.FASTGPT_DATASET_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const collections = await Promise.all(
      datasetIds.map(async (datasetId) => ({
        datasetId,
        count: await this.client.collectionCount(datasetId).catch(() => 0),
      })),
    );
    return { datasetIds, collections };
  }

  async search(question: string, limit = 5) {
    return this.client.searchTest(question, { limit });
  }

  async ingestQa(pairs: ReadonlyArray<{ question: string; answer: string }>, datasetName = 'cs-bot-learning') {
    const datasetId = await this.client.ensureDataset(datasetName);
    const ids = await this.client.writeBatch(datasetId, pairs);
    this.logger.log({ detail: 'knowledge-ingest', count: pairs.length });
    return { datasetId, ids };
  }
}
