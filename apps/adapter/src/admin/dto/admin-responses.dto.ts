/**
 * admin 控制器响应 DTO
 *
 * config / license / miss 三个控制器 2xx 返回体；字段与控制器实现一一对应。
 * 独立 class 是因为 swagger 只能从 class 的 @ApiProperty 反射出 schema。
 */
import { ApiProperty } from '@nestjs/swagger';
import { LicenseStateDto } from '../../common/dto/license-state.dto.js';
import { UsageSnapshotDto } from '../../common/dto/usage.dto.js';

/** GET /admin/config：配置自检结果 */
export class ConfigCheckDto {
  @ApiProperty({ description: '运行模式开关' })
  mode!: { useMockLlm: boolean; useMockLicense: boolean };

  @ApiProperty({
    description: '逐配置项检查：present 是否设置，masked 仅密钥类有（脱敏值）',
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        present: { type: 'boolean' },
        masked: { type: 'string', nullable: true },
      },
    },
  })
  config!: Record<string, { present: boolean; masked?: string }>;
}

/** POST /admin/config/reload、/admin/keywords/reload */
export class ConfigReloadDto {
  @ApiProperty({ description: '是否触发重载', example: true })
  reloaded!: boolean;

  @ApiProperty({ description: '重载后的关键词数量', example: 42 })
  keywords!: number;
}

export class KeywordsReloadDto {
  @ApiProperty({ description: '是否触发重载', example: true })
  reloaded!: boolean;

  @ApiProperty({ description: '关键词数量', example: 42 })
  count!: number;
}

/** GET /admin/license：LicenseState + currentUsage */
export class LicenseStatusDto extends LicenseStateDto {
  @ApiProperty({
    description: '当前周期用量节选',
    type: Object,
  })
  currentUsage!: { messagesReceived: number; assetsSent: number };
}

/** POST /admin/license/reload：重载即重新走一次 startupCheck */
export class LicenseReloadDto extends LicenseStateDto {}

/** GET /admin/usage */
export class AdminUsageDto extends UsageSnapshotDto {}
