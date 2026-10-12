/** AssetSenderService */
import { Injectable } from '@nestjs/common';
import { WecomClient } from '../wecom/wecom-client.js';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';

export interface Asset { id: string; type: 'link' | 'file' | 'video'; url?: string; path?: string; }

@Injectable()
export class AssetSenderService {
  private readonly logger = new AppLogger('AssetSenderService');

  constructor(private readonly wecomClient: WecomClient) {}

  async send(chatId: string, asset: Asset): Promise<void> {
    try {
      switch (asset.type) {
        case 'link': await this.wecomClient.sendText(chatId, asset.url ?? ''); break;
        case 'file': {
          if (!asset.path) throw Object.assign(new Error('no file path'), { code: ErrCode.ASSET_NOT_FOUND });
          const mediaId = await this.wecomClient.uploadMedia('file', asset.path);
          await this.wecomClient.sendFile(chatId, mediaId);
          break;
        }
        case 'video': {
          if (!asset.path) throw Object.assign(new Error('no file path'), { code: ErrCode.ASSET_NOT_FOUND });
          const mediaId = await this.wecomClient.uploadMedia('video', asset.path);
          await this.wecomClient.sendVideo(chatId, mediaId);
          break;
        }
      }
    } catch (err) {
      this.logger.warn({ errCode: ErrCode.ASSET_SEND_FAIL, assetId: asset.id, err: (err as Error).message });
    }
  }
}
