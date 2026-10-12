/** AssetSenderService */
import { Injectable, Inject } from '@nestjs/common';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';
import { IMessageSender } from '../qa/message-sender.port.js';

export interface Asset { id: string; type: 'link' | 'file' | 'video'; url?: string; path?: string; }

@Injectable()
export class AssetSenderService {
  private readonly logger = new AppLogger('AssetSenderService');

  constructor(@Inject(IMessageSender) private readonly sender: IMessageSender) {}

  async send(chatId: string, asset: Asset): Promise<void> {
    try {
      await this.sender.sendAsset(chatId, asset.url ?? asset.path ?? asset.id, asset.type);
    } catch (err) {
      this.logger.warn({ errCode: ErrCode.ASSET_SEND_FAIL, assetId: asset.id, err: (err as Error).message });
    }
  }
}
