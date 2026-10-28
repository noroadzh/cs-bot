/**
 * 企微回调控制器
 * 握手验证 + 消息解密路由
 */
import { Controller, Post, Query, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WecomCrypto } from './wecom-crypto.js';
import { WecomClient } from './wecom-client.js';
import { RoutingService } from '../routing/routing.service.js';
import { MediaRecognizeService } from '../media/media-recognize.service.js';
import { UsageService } from '../usage/usage.service.js';
import { MissService } from '../miss/miss.service.js';
import { ConfigService } from '../config/config.service.js';
import { LicenseGateService } from '../license/license-gate.service.js';
import {
  LICENSE_INVALID_TEXT,
  LICENSE_CHAT_LIMIT_TEXT,
  TENANT_INACTIVE_TEXT,
  TENANT_READONLY_TEXT,
  TENANT_CHAT_LIMIT_TEXT,
  TENANT_MSG_LIMIT_TEXT,
} from '../license/license-gate.service.js';
import { AppLogger } from '../common/logger.js';
import { ImageTaskQueue } from '../media/image-task-queue.js';
import { ErrCode } from '@cs-bot/shared';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { WecomCallbackQueryDto, WecomCallbackBodyDto } from './dto/wecom-callback.dto.js';

/** 准入拦截话术（webhook 只能 200，用话术表达 403/409/429 语义） */
/** 语音/视频/文件入站引导话术（FR-9 规则 3） */
const MEDIA_GUIDANCE_TEXT =
  '抱歉，我暂时无法直接查看语音、视频或文件，请用文字描述问题（可注明文件名），或 @人工客服 协助。';

const GATE_TEXTS: Record<string, string> = {
  'license-invalid': LICENSE_INVALID_TEXT,
  'chat-limit': LICENSE_CHAT_LIMIT_TEXT,
  'tenant-inactive': TENANT_INACTIVE_TEXT,
  'tenant-readonly': TENANT_READONLY_TEXT,
  'tenant-chat-limit': TENANT_CHAT_LIMIT_TEXT,
  'tenant-msg-limit': TENANT_MSG_LIMIT_TEXT,
};

@ApiTags('wecom')
@Controller('wecom')
export class WecomController {
  private readonly logger = new AppLogger('WecomController');
  private readonly imageQueue = new ImageTaskQueue();

  constructor(
    private readonly crypto: WecomCrypto,
    private readonly routingService: RoutingService,
    private readonly usageService: UsageService,
    private readonly recognizeService: MediaRecognizeService,
    private readonly wecomClient: WecomClient,
    private readonly licenseGate: LicenseGateService,
    private readonly miss: MissService,
  ) {}

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '企微消息回调：URL 握手验证 + 加密消息接收' })
  @ApiBody({
    description: '企微加密消息体（application/json 或 xml 明文）',
    schema: {
      oneOf: [
        { $ref: '#/components/schemas/WecomCallbackBodyDto' },
        { type: 'string' },
      ],
    },
  })
  @ApiResponse({
    status: 200,
    description: '握手返回明文 echostr（text）；消息接收成功返回空串 ack',
    schema: { oneOf: [{ type: 'string' }, { type: 'object', properties: { errCode: { type: 'number' } } }] },
  })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'XML 解析失败' })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: '签名校验失败 / 解密失败' })
  async callback(
    @Query() q: WecomCallbackQueryDto,
    @Body() body: WecomCallbackBodyDto | string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { msg_signature: msgSignature, timestamp, nonce, echostr } = q;
    let traceId: string = crypto.randomUUID();
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
    // 详设：traceId = msgid（贯穿 D1–D9）；握手/无 MsgId 时保留请求级 UUID
    if (msg.MsgId) {
      traceId = msg.MsgId;
      msg.traceId = traceId;
    }

    // 12.2 Increment messagesReceived for every valid incoming message
    this.usageService.increment('messagesReceived');

    // 群聊强校验：缺少 ChatId 时无法定位群，禁止回退到私聊
    if ((ConfigService.instance.REQUIRE_GROUP_CHAT_ID ?? true) && !msg.ChatId) {
      this.usageService.increment('messagesDroppedNoChatId');
      this.logger.warn({ traceId, msgId: msg.MsgId, detail: 'missing-chat-id' });
      res.status(HttpStatus.OK).send('');
      return;
    }

    // M9 授权闸门：license 失效 → 受限模式；新群超 maxChats → 拒绝。
    // 拦截时代发提示话术，消息不进 routing（也不做图片识别，省识别成本）。
    const gateChatId = (msg as { ChatId?: string; FromUserName?: string }).ChatId
      || (msg as { FromUserName?: string }).FromUserName
      || '';
    let gateBlocked = false;
    if (gateChatId) {
      const decision = await this.licenseGate.check(gateChatId, '');
      if (!decision.allowed) {
        gateBlocked = true;
        // 非 strict 下可辨识联合窄化不完美，显式取 reason
        const reason = (decision as { reason: string }).reason;
        const text = GATE_TEXTS[reason] ?? LICENSE_INVALID_TEXT;
        try {
          await this.wecomClient.sendText(gateChatId, text);
        } catch (err) {
          this.logger.warn({ traceId, detail: 'license-gate-notice-fail', err: (err as Error).message });
        }
      }
    }
    if (gateBlocked) {
      res.status(HttpStatus.OK).send('');
      return;
    }

    // FR-9 规则 3：@机器人的语音/视频/文件不解析，回引导话术 + 未命中落库（media_type）
    const mediaMsg = msg as any;
    if (mediaMsg.mentioned && ['voice', 'video', 'file'].includes(mediaMsg.MsgType)) {
      const mediaChatId = mediaMsg.ChatId || mediaMsg.FromUserName;
      if (mediaChatId) {
        await this.miss.record({
          traceId,
          chatId: mediaChatId,
          userId: mediaMsg.FromUserName,
          question: mediaMsg.Content ?? `[${mediaMsg.MsgType}]`,
          score: 0,
          engine: 'media',
          mediaType: mediaMsg.MsgType,
          ts: new Date().toISOString(),
        });
        try {
          await this.wecomClient.sendText(mediaChatId, MEDIA_GUIDANCE_TEXT);
        } catch (err) {
          this.logger.warn({ traceId, detail: 'media-guidance-fail', err: (err as Error).message });
        }
      }
      res.status(HttpStatus.OK).send('');
      return;
    }

    // 图片：先 ack，再异步下载/识别/发送；识别结果非 [NO_TEXT] 才进入问答链路。
    const GUIDANCE_TEXT = '抱歉，暂时没看懂这张图片，麻烦用文字简述一下您的问题～';
    const parsedMsg = msg as any;
    if (!parsedMsg.Content && parsedMsg.MediaId && parsedMsg.MsgType === 'image') {
      this.usageService.increment('imagesReceived');
      const key = String(parsedMsg.MsgId ?? parsedMsg.MediaId);
      const result = this.imageQueue.enqueue(key, () =>
        this.processImage(parsedMsg, traceId, GUIDANCE_TEXT),
      );
      res.status(HttpStatus.OK).send('');
      if (result === 'full') {
        this.logger.warn({ traceId, detail: 'image-queue-full', key });
        await this.sendGuidanceAndSkipRouting(parsedMsg, traceId, GUIDANCE_TEXT);
      }
      return;
    }

    // 群聊（appchat）不支持被动回复，必须立即 ack 后走主动发送；
    // 详设的 3.5s 被动竞速适用于单聊/应用消息，本产品群聊场景不适用。
    res.status(HttpStatus.OK).send('');
    this.routingService.dispatch(msg, traceId).catch((err) => {
      this.logger.error({ traceId, err: (err as Error).message });
    });
  }

  /** 图片异步处理：下载 → 识别 → 进入问答或引导话术 */
  private async processImage(
    msg: { MediaId?: string; MsgId?: string; ChatId?: string; FromUserName?: string },
    traceId: string,
    guidance: string,
  ): Promise<void> {
    try {
      const buf = await this.wecomClient.downloadMedia(String(msg.MediaId));
      const maxBytes = ConfigService.instance.MAX_IMAGE_BYTES ?? 10 * 1024 * 1024;
      if (buf.length > maxBytes) throw new Error(`image too large: ${buf.length} > ${maxBytes}`);
      const description = (await this.recognizeService.recognizeImage(buf, detectImageMime(buf))).trim();
      if (!description || description.toUpperCase() === '[NO_TEXT]') {
        this.usageService.increment('imagesSkipped');
        await this.sendGuidanceAndSkipRouting(msg, traceId, guidance);
        return;
      }
      this.usageService.increment('imagesRecognized');
      const inbound = msg as any;
      inbound.Content = description;
      inbound.Recognition = description;
      await this.routingService.dispatch(inbound, traceId);
    } catch (err) {
      this.usageService.increment('imagesSkipped');
      this.logger.warn({ traceId, detail: 'image-recognize-failed', err: (err as Error).message });
      await this.sendGuidanceAndSkipRouting(msg, traceId, guidance);
    }
  }

  /**
   * 识别失败时：直接发引导话术，不走 routing 链路
   */
  private async sendGuidanceAndSkipRouting(
    msg: { AgentID?: string; FromUserName?: string; ChatId?: string },
    traceId: string,
    text: string,
  ): Promise<void> {
    const chatId = msg.ChatId || msg.FromUserName;
    if (!chatId) {
      this.logger.warn({ traceId, detail: 'no-chat-id-for-guidance' });
      return;
    }
    try {
      await this.wecomClient.sendText(chatId, text);
      this.logger.log({ traceId, chatId, detail: 'guidance-sent' });
    } catch (err) {
      this.logger.error({ traceId, chatId, detail: 'guidance-send-fail', err: (err as Error).message });
    }
  }
}

function detectImageMime(buf: Buffer): string {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return 'image/gif';
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return 'image/jpeg';
}
