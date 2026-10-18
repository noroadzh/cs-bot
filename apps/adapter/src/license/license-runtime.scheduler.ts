/**
 * License 运行期定时任务（M9）
 *
 * 每日 03:00 低峰期：
 *   1. licenseService.revalidate()  → 运行期复核（重读 license 文件 + 反回放）
 *   2. 到期提醒                      → 剩余 ≤15 天（或已失效）经 webhook 提醒，每日一次
 *
 * mock 模式只复核不告警（开发环境不制造噪音）。
 * 定时器 unref：不阻止进程退出；onModuleDestroy 清理。
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { LicenseService } from './license.service.js';
import { LicenseAlertService } from './license-alert.service.js';

/** 到期提醒阈值：剩余天数 ≤ 该值开始每日提醒 */
export const EXPIRY_WARN_DAYS = 15;

@Injectable()
export class LicenseRuntimeScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LicenseScheduler');
  private timer: NodeJS.Timeout | null = null;
  /** 当日已提醒的天序号（同一自然日只提醒一次） */
  private warnedDay = -1;

  constructor(
    private readonly licenseService: LicenseService,
    private readonly alertService: LicenseAlertService,
  ) {}

  onModuleInit() {
    this.scheduleNext();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 距下一个 03:00（本机时区）的毫秒数 */
  msUntil3am(now = new Date()): number {
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  private scheduleNext() {
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNext());
    }, this.msUntil3am());
    this.timer.unref();
  }

  /** 单次夜间任务：复核 + 到期提醒。异常只 warn，不允许打死循环调度 */
  async tick(): Promise<void> {
    const today = Math.floor(Date.now() / 86_400_000);
    try {
      const state = this.licenseService.revalidate();
      this.logger.log(
        `nightly revalidate: valid=${state.valid} reason=${state.reason} daysLeft=${state.daysLeft}`,
      );

      if (ConfigService.instance.USE_MOCK_LICENSE) return;
      if (state.valid && state.daysLeft > EXPIRY_WARN_DAYS) return;
      if (this.warnedDay === today) return;
      this.warnedDay = today;

      const content = state.valid
        ? `授权即将到期：剩余 ${state.daysLeft} 天（${new Date(state.expiresAtMs).toISOString().slice(0, 10)}），请联系管理员续期`
        : `授权已失效：reason=${state.reason}，机器人已进入受限模式`;
      await this.alertService.sendAlert(content);
    } catch (err) {
      this.logger.warn(`nightly license task failed: ${(err as Error).message}`);
    }
  }
}
