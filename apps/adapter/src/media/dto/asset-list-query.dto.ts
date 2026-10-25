/**
 * GET /admin/assets 的分页查询 DTO
 *
 * limit/offset 以字符串形式接收（query 永远是 string），由控制器内的
 * toPositiveInt() 转为正整数；DTO 本身保留 string 类型以匹配传输层。
 */
import { ApiProperty } from '@nestjs/swagger';

export class AssetListQueryDto {
  @ApiProperty({
    required: false,
    type: String,
    description: '每页数量（正整数字符串），缺省 20',
  })
  limit?: string;

  @ApiProperty({
    required: false,
    type: String,
    description: '偏移量（正整数字符串），缺省 0',
  })
  offset?: string;
}
