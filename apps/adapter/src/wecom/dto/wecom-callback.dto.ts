/**
 * 企微回调控制器（POST /wecom/callback）的请求 DTO
 *
 * Query 4 个：msg_signature / timestamp / nonce 必填，echostr 仅握手时存在。
 * Body 用 {Encrypt?: string}，与控制器当前实现保持一致（NestJS 不会把 multipart/raw 误解析为此 DTO）。
 */
import { ApiProperty } from '@nestjs/swagger';

export class WecomCallbackQueryDto {
  @ApiProperty({ required: true, description: '企微加密签名' })
  msg_signature!: string;

  @ApiProperty({ required: true, description: '时间戳' })
  timestamp!: string;

  @ApiProperty({ required: true, description: '随机数' })
  nonce!: string;

  @ApiProperty({ required: false, description: 'URL 验证密文（仅首次握手携带）' })
  echostr?: string;
}

export class WecomCallbackBodyDto {
  @ApiProperty({ required: false, description: '加密消息体（企微 AES 加密结果）' })
  Encrypt?: string;
}
