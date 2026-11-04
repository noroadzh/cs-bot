/**
 * Prometheus text exposition（可开关）
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { UsageService } from '../usage/usage.service.js';

@Injectable()
export class MetricsService {
  constructor(private readonly usage: UsageService) {}

  enabled(): boolean {
    return Boolean(ConfigService.instance.METRICS_ENABLED);
  }

  render(): string {
    const c = this.usage.getUsage().counters;
    const lines = [
      '# HELP csbot_up Process up',
      '# TYPE csbot_up gauge',
      'csbot_up 1',
      '# HELP csbot_messages_received_total Inbound messages',
      '# TYPE csbot_messages_received_total counter',
      `csbot_messages_received_total ${c.messagesReceived}`,
      '# HELP csbot_messages_answered_total QA answered',
      '# TYPE csbot_messages_answered_total counter',
      `csbot_messages_answered_total ${c.messagesAnswered}`,
      '# HELP csbot_messages_missed_total Miss / refusal path',
      '# TYPE csbot_messages_missed_total counter',
      `csbot_messages_missed_total ${c.messagesMissed}`,
      '# HELP csbot_llm_failures_total LLM failures',
      '# TYPE csbot_llm_failures_total counter',
      `csbot_llm_failures_total ${c.llmFailures}`,
      '',
    ];
    return lines.join('\n');
  }
}
