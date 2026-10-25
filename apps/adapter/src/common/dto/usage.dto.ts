/**
 * 用量快照 DTO
 *
 * 与 usage.service.ts 的 UsageCounters / UsageSnapshot 一一对应。
 * 独立 class 是因为 swagger 只能从 class 的 @ApiProperty 反射出 schema。
 */
import { ApiProperty } from '@nestjs/swagger';

export class UsageCountersDto {
  @ApiProperty({ description: '收到的消息总数', example: 128 })
  messagesReceived!: number;

  @ApiProperty({ description: '已回复的消息数', example: 96 })
  messagesAnswered!: number;

  @ApiProperty({ description: '拒绝回复的消息数', example: 4 })
  messagesRefused!: number;

  @ApiProperty({ description: '未识别（miss）的消息数', example: 22 })
  messagesMissed!: number;

  @ApiProperty({ description: '发出的媒体/资产回复数', example: 32 })
  assetsSent!: number;

  @ApiProperty({ description: '主模型 token 消耗', example: 5432 })
  tokensPrimary!: number;

  @ApiProperty({ description: '兜底模型 token 消耗', example: 890 })
  tokensFallback!: number;

  @ApiProperty({ description: '收到的图片消息数', example: 12 })
  imagesReceived!: number;

  @ApiProperty({ description: '完成识别的图片数', example: 10 })
  imagesRecognized!: number;

  @ApiProperty({ description: '跳过识别的图片数', example: 2 })
  imagesSkipped!: number;

  @ApiProperty({ description: '触发回复的消息数', example: 100 })
  messagesTriggered!: number;
}

export class UsageSnapshotDto {
  @ApiProperty({ description: '统计周期', enum: ['daily', 'weekly', 'monthly'], example: 'daily' })
  period!: 'daily' | 'weekly' | 'monthly';

  @ApiProperty({ description: '周期起点（ISO 8601）', example: '2026-10-16T00:00:00.000Z' })
  startedAt!: string;

  @ApiProperty({ type: UsageCountersDto, description: '周期内计数器' })
  counters!: UsageCountersDto;

  @ApiProperty({ description: '快照生成时间（ISO 8601）', example: '2026-10-16T09:30:00.000Z' })
  generatedAt!: string;
}
