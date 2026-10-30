/** AssetSenderService */
import { Injectable, Inject } from '@nestjs/common';
import { basename, join } from 'node:path';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';
import { IMessageSender } from '../qa/message-sender.port.js';

export interface Asset {
  id: string;
  type: 'link' | 'file' | 'video';
  url?: string;
  path?: string;
  name?: string;
}

/** 素材落盘目录（与 AssetService 一致） */
const ASSET_DIR = join(process.cwd(), 'data', 'assets');

/**
 * 把 asset.url（对外相对路径 `/assets/<id>.<ext>`）映射为落盘绝对路径。
 * 用 basename 阻断 `..` 逃逸；已是绝对路径的直接透传。
 */
export function toLocalAssetPath(target?: string): string | undefined {
  if (!target) return undefined;
  if (target.startsWith('/assets/')) return join(ASSET_DIR, basename(target));
  return target;
}

@Injectable()
export class AssetSenderService {
  private readonly logger = new AppLogger('AssetSenderService');

  constructor(@Inject(IMessageSender) private readonly sender: IMessageSender) {}

  /**
   * 外发单个素材。失败只记 WARN 并返回 false——是否补发降级提示由调用方决定。
   */
  async send(chatId: string, asset: Asset): Promise<boolean> {
    const raw = asset.url ?? asset.path;
    const target = asset.type === 'link'
      ? raw ?? asset.id
      : toLocalAssetPath(raw) ?? join(ASSET_DIR, asset.id);
    try {
      await this.sender.sendAsset(chatId, target, asset.type, asset.name);
      return true;
    } catch (err) {
      this.logger.warn({
        errCode: ErrCode.ASSET_SEND_FAIL,
        assetId: asset.id,
        type: asset.type,
        err: (err as Error).message,
      });
      return false;
    }
  }
}
