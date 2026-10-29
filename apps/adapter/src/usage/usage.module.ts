/**
 * Usage module - counters, snapshots, and webhook reporting
 */
import { Module, Global } from '@nestjs/common';
import { UsageService } from './usage.service.js';
import { UsageWebhookService } from './usage-webhook.service.js';
import { UsageReporterScheduler } from './usage-reporter.scheduler.js';
import { CapacityUsageService } from './capacity-usage.service.js';
import { CapacityGuard } from './capacity-guard.service.js';
import { FastGPTClient } from '../qa/fastgpt.client.js';
import { ConfigService } from '../config/config.service.js';

@Global()
@Module({
  providers: [
    UsageService,
    UsageWebhookService,
    CapacityUsageService,
    CapacityGuard,
    UsageReporterScheduler,
    {
      // 统一 FastGPT 客户端（R-2）：用量统计与问答/导入共用同一凭据与超时配置
      provide: FastGPTClient,
      useFactory: () => {
        const cfg = ConfigService.instance;
        return new FastGPTClient({
          baseUrl: cfg.FASTGPT_BASE_URL,
          apiKey: cfg.FASTGPT_API_KEY,
          timeoutMs: 5000,
          datasetIds: (cfg.FASTGPT_DATASET_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
        });
      },
    },
  ],
  exports: [UsageService, UsageWebhookService, CapacityGuard, FastGPTClient],
})
export class UsageModule {}