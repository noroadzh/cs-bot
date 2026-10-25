/**
 * 统一错误响应 DTO
 * 用于 4xx/5xx 错误响应的 schema
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ description: '错误码', example: 1001 })
  errCode!: number;

  @ApiPropertyOptional({ description: '错误信息（部分错误有）', example: 'ASSET_NOT_FOUND' })
  errMessage?: string;

  @ApiPropertyOptional({ description: '详细错误信息', example: 'Asset with id xxx not found' })
  detail?: string;
}