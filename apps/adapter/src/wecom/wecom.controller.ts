/**
 * 企微回调控制器
 * 握手验证 + 消息解密路由
 */
import { Controller, Post, Query, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WecomCrypto } from './wecom-crypto.js';
import { WecomClient } from './wecom-client.js';
import { RoutingService } from '../routing/routing.service.js';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';

@Controller('wecom')
export class WecomController {
  private readonly logger = new AppLogger('WecomController');
  private readonly crypto = new WecomCrypto({} as any);

  constructor(
    private readonly wecomClient: WecomClient,
    private readonly routingService: RoutingService,
  ) {}

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async callback(
    @Query('msg_signature') msgSignature: string,
    @Query('timestamp') timestamp: string,
    @Query('nonce') nonce: string,
    @Query('echostr') echostr: string | undefined,
    @Body() body: { Encrypt?: string } | string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const traceId = crypto.randomUUID();
    this.logger.log({ traceId, msgSignature, timestamp });

    if (echostr !== undefined) {
      const decrypt = await this.crypto.decryptMsg(msgSignature, timestamp, nonce, echostr);
      if (!decrypt) {
        res.status(HttpStatus.UNAUTHORIZED).json({ errCode: ErrCode.WECOM_SIGN_INVALID });
        return;
      }
      res.status(HttpStatus.OK).send(decrypt);
      return;
    }

    const encrypt = typeof body === 'string' ? body : (body as any).Encrypt ?? '';
    const decrypted = await this.crypto.decryptMsg(msgSignature, timestamp, nonce, encrypt);
    if (!decrypted) {
      res.status(HttpStatus.UNAUTHORIZED).json({ errCode: ErrCode.WECOM_SIGN_INVALID });
      return;
    }

    const msg = await this.crypto.parseXml(decrypted, traceId);
    if (!msg) {
      res.status(HttpStatus.BAD_REQUEST).json({ errCode: ErrCode.WECOM_DECRYPT_FAIL });
      return;
    }

    res.status(HttpStatus.OK).send('');
    this.routingService.dispatch(msg, traceId).catch((err) => {
      this.logger.error({ traceId, err: (err as Error).message });
    });
  }
}
