/**
 * 企微回调控制器
 * 握手验证 + 消息解密路由
 */
import { Controller, Post, Query, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WecomCrypto } from './wecom-crypto.js';
import { WecomClient } from './wecom-client.js';
import { RoutingService } from '../routing/routing.service.js';
import { MediaRecognizeService } from '../media/media-recognize.service.js';
import { UsageService } from '../usage/usage.service.js';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';

@Controller('wecom')
export class WecomController {
  private readonly logger = new AppLogger('WecomController');

  constructor(
    private readonly crypto: WecomCrypto,
    private readonly routingService: RoutingService,
    private readonly usageService: UsageService,
    private readonly recognizeService: MediaRecognizeService,
    private readonly wecomClient: WecomClient,
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

    // 12.2 Increment messagesReceived for every valid incoming message
    this.usageService.increment('messagesReceived');

    // 6.1 / 6.2 / 6.3 Image message handling: if the inbound message carries a
    // MediaId and no text Content, download the bytes and run image recognition
    // before dispatching to the routing pipeline. The recognition description is
    // injected as Content so the QA engine sees a normal text query. Failures
    // must not block message routing.
    const parsedMsg = msg as any;
    if (!parsedMsg.Content && parsedMsg.MediaId && parsedMsg.MsgType === 'image') {
      this.usageService.increment('imagesReceived');
      try {
        const buf = await this.wecomClient.downloadMedia(parsedMsg.MediaId);
        const description = await this.recognizeService.recognizeImage(buf, 'image/jpeg');
        if (description) {
          this.usageService.increment('imagesRecognized');
          parsedMsg.Content = description;
          parsedMsg.Recognition = description;
        } else {
          this.usageService.increment('imagesSkipped');
          parsedMsg.Content = '[图片消息]';
        }
      } catch (err) {
        this.usageService.increment('imagesSkipped');
        this.logger.warn({ traceId, detail: 'image-recognize-failed', err: (err as Error).message });
        parsedMsg.Content = '[图片消息]';
      }
    }

    res.status(HttpStatus.OK).send('');
    this.routingService.dispatch(msg, traceId).catch((err) => {
      this.logger.error({ traceId, err: (err as Error).message });
    });
  }
}
