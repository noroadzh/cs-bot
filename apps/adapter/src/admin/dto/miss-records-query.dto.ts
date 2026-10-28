/**
 * GET /admin/miss-records 的查询参数 DTO
 * 与 ApiResponse type 规则不同：query/body DTO 用 @ApiProperty({required}) 描述，
 * 控制器配合 @Query() 装饰器即可让 Swagger UI 渲染表单。
 */
import { ApiProperty } from '@nestjs/swagger';

export class MissRecordsQueryDto {
  @ApiProperty({
    required: false,
    enum: ['json', 'xlsx'],
    description: '导出格式，默认 json；其他值（如 csv）按 json 处理',
  })
  format?: string;

  @ApiProperty({
    required: false,
    type: String,
    description: '回溯天数（正整数），默认 90；非正整数会返回 400',
  })
  days?: string;

  @ApiProperty({ required: false, type: String, description: '起始时间（ISO），优先于 days' })
  from?: string;

  @ApiProperty({ required: false, type: String, description: '结束时间（ISO），与 from 配合' })
  to?: string;
}
