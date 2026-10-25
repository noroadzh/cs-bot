/**
 * License 校验结果 DTO
 *
 * 与 license.types.ts 的 LicenseState 结构一一对应；独立 class 是因为
 * swagger 只能从 class 的 @ApiProperty 反射出 schema，interface 不行。
 */
import { ApiProperty } from '@nestjs/swagger';

export class LicenseStateDto {
  @ApiProperty({ description: '校验是否通过（含绑定与反回放）', example: true })
  valid!: boolean;

  @ApiProperty({
    description: "诊断原因；'valid' 表示全部通过",
    example: 'valid',
    enum: [
      'valid',
      'bad-format',
      'bad-payload',
      'bad-signature',
      'expired',
      'empty-fingerprint',
      'fingerprint-mismatch',
      'antireplay-failure',
      'native-not-loaded',
      'native-error',
      'selfcheck-failed',
      'mock-no-license',
      'malformed',
      'revoked',
      'unchecked',
    ],
  })
  reason!: string;

  @ApiProperty({ description: '是否 mock 模式校验', example: true })
  mock!: boolean;

  @ApiProperty({ description: 'license 绑定的机器指纹；无绑定为空串', example: 'a1b2c3d4' })
  fingerprint!: string;

  @ApiProperty({ description: '过期时间（Unix ms）；无信息为 0', example: 1798761600000 })
  expiresAtMs!: number;

  @ApiProperty({ description: '剩余天数；已过期为负', example: 30 })
  daysLeft!: number;

  @ApiProperty({ description: '授权群数量上限', example: 50 })
  maxChats!: number;
}
