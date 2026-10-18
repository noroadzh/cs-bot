/**
 * License 运维告警
 *
 * 概要设计 M9：证书 ≤15 天到期每日提醒、新群被拒、指纹变化等
 * 运维事件经 OPS_WEBHOOK_URL（企微群机器人）推送；URL 为空 = 告警关闭。
 * 告警失败只 warn 不抛——告警是旁路，不允许影响业务链路。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';

@Injectable()
export class LicenseAlertService {
  private readonly logger = new Logger('LicenseAlert');

  /**
   * 发送文本告警。返回是否真正发出（URL 未配置或请求失败均返回 false）。
   */
  async sendAlert(content: string): Promise<boolean> {
    const url = ConfigService.instance.OPS_WEBHOOK_URL;
    if (!url) return false;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: `[cs-bot] ${content}` } }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(`alert webhook non-ok: status=${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`alert webhook failed: ${(err as Error).message}`);
      return false;
    }
  }
}
