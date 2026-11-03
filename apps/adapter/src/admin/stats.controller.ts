/** GET /admin/stats/overview — 运营看板聚合 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard.js';
import { UsageService } from '../usage/usage.service.js';
import { MissExportService } from '../miss/miss-export.service.js';

@Controller('admin/stats')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class StatsController {
  constructor(
    private readonly usage: UsageService,
    private readonly missExport: MissExportService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: '看板概览：问答量/命中率/拒答率/未命中 TOP' })
  async overview(@Query('period') period?: 'daily' | 'weekly' | 'monthly') {
    const snap = this.usage.getUsage(period ?? 'daily');
    const c = snap.counters;
    const messages = c.messagesReceived || 0;
    const hits = c.messagesAnswered || 0;
    const refusals = c.messagesRefused || 0;
    const missed = c.messagesMissed || 0;
    const denom = Math.max(messages, 1);
    const items = await this.missExport.queryItems(period === 'weekly' ? 7 : period === 'monthly' ? 30 : 1);
    const topMiss = items
      .slice(0, 20)
      .map((it) => ({ question: it.question, score: it.score, chatId: it.chatId, status: it.status }));
    const chatActivity = new Map<string, number>();
    for (const it of items) {
      chatActivity.set(it.chatId, (chatActivity.get(it.chatId) ?? 0) + 1);
    }
    return {
      period: snap.period,
      messages,
      hits,
      refusals,
      missed,
      hitRate: hits / denom,
      refusalRate: refusals / denom,
      topMiss,
      chatActivity: [...chatActivity.entries()].map(([chatId, count]) => ({ chatId, count })),
    };
  }
}
