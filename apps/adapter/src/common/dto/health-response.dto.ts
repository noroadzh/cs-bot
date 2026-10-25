/**
 * Health check response DTO
 */
import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ description: '服务状态', example: 'ok' })
  status!: string;

  @ApiProperty({ description: 'License 状态' })
  license!: {
    valid: boolean;
    mock: boolean;
  };
}

/**
 * Health check degraded response DTO
 */
export class HealthDegradedResponseDto {
  @ApiProperty({ description: '服务状态', example: 'degraded' })
  status!: string;

  @ApiProperty({ description: '不可用的依赖', example: ['redis', 'postgresql'] })
  deps!: string[];

  @ApiProperty({ description: 'License 状态' })
  license!: {
    valid: boolean;
    mock?: boolean;
  };
}