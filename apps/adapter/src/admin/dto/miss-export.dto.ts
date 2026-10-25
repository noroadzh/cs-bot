/**
 * Miss 记录导出 DTO
 */
import { ApiProperty } from '@nestjs/swagger';

export class MissRecordDto {
  @ApiProperty({ description: '链路追踪 id', format: 'uuid', example: 'a1b2c3d4-...' })
  traceId!: string;

  @ApiProperty({ description: '群聊 id', example: 'wx群id' })
  chatId!: string;

  @ApiProperty({ description: '发送者 userid', example: 'zhangsan' })
  userId!: string;

  @ApiProperty({ description: '未识别消息', example: '这个产品怎么买？' })
  question!: string;

  @ApiProperty({ description: '最高相似度', example: 0.35 })
  score!: number;

  @ApiProperty({ description: '匹配引擎', example: 'keyword' })
  engine!: string;

  @ApiProperty({ description: '创建时间（ISO 8601）', example: '2026-10-15T14:30:00.000Z' })
  createdAt!: string;
}

/** GET /admin/miss · 200 */
export class MissExportDto {
  @ApiProperty({ description: '总条数', example: 42 })
  total!: number;

  @ApiProperty({ type: [MissRecordDto] })
  rows!: MissRecordDto[];
}