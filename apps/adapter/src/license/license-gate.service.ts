/**
 * LicenseGateService：消息入口授权闸门（M9）
 *
 * wecom 每条有效消息在进入 routing 前过闸：
 *   1. USE_MOCK_LICENSE=true → 放行（mock 即开发模式，不拦业务）
 *   2. license.valid=false   → 受限模式：回授权提示话术，消息不进 QA
 *   3. 群数上限              → 未注册群超过 maxChats：回超限话术 + 运维告警
 *
 * 话术每条消息都回（用户视角可感知）；webhook 告警按 chatId 去重（每群每天一次）。
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';
import { LicenseService } from './license.service.js';
import { LicensedChatService } from './licensed-chat.service.js';
import { LicenseAlertService } from './license-alert.service.js';
import { TenantGateService } from './tenant-gate.service.js';

/** 群超限告警去重 TTL：48h 覆盖自然日边界 */
const ALERT_DEDUP_TTL = 172_800;

export const LICENSE_INVALID_TEXT =
  '本机器人的授权已失效或过期，暂时无法为您服务，请联系管理员处理。';
export const LICENSE_CHAT_LIMIT_TEXT =
  '本机器人的授权群数已达上限，暂时无法在新群中启用，请联系管理员扩容授权。';
export const TENANT_INACTIVE_TEXT =
  '本服务当前已暂停或未开通，暂时无法为您服务，请联系管理员处理。';
export const TENANT_CHAT_LIMIT_TEXT =
  '本租户的会话数已达套餐上限，暂时无法在新群中启用，请联系管理员升级套餐。';
export const TENANT_READONLY_TEXT =
  '服务已到期，当前为只读模式，暂不能新增群；问答仍可用，请联系服务商续期。';
export const TENANT_MSG_LIMIT_TEXT =
  '本租户今日的消息量已达套餐上限，请稍后再试或联系管理员升级套餐。';

export type GateDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'license-invalid'
        | 'chat-limit'
        | 'tenant-inactive'
        | 'tenant-readonly'
        | 'tenant-chat-limit'
        | 'tenant-msg-limit';
    };

@Injectable()
export class LicenseGateService implements OnModuleDestroy {
  private readonly logger = new Logger('LicenseGate');
  /** L1 进程内去重：chatId -> 当日（天序号）；Redis 故障时的兜底 */
  private readonly alertedToday = new Map<string, number>();
  private readonly redis: Redis;

  constructor(
    private readonly licenseService: LicenseService,
    private readonly licensedChats: LicensedChatService,
    private readonly alertService: LicenseAlertService,
    private readonly tenantGate: TenantGateService,
  ) {
    const cfg = ConfigService.instance;
    this.redis = new Redis({
      host: cfg.REDIS_HOST,
      port: cfg.REDIS_PORT,
      password: cfg.REDIS_PASSWORD || undefined,
      lazyConnect: true,
    });
  }

  onModuleDestroy() {
    // lazyConnect 下未建立的连接直接 disconnect 防止挂起；已建立的走 quit 优雅关闭
    this.redis.disconnect();
  }

  /**
   * 消息入口闸门。
   * @returns allowed=true 放行进 routing；allowed=false 已拦截（调用方按 reason 代发话术）
   */
  async check(chatId: string, chatName: string): Promise<GateDecision> {
    // mock 模式放行：开发/演示场景不因缺 license 文件阻断消息
    if (ConfigService.instance.USE_MOCK_LICENSE) return { allowed: true };

    const state = this.licenseService.getState();
    if (!state.valid) {
      this.logger.warn(`gate blocked (license ${state.reason}): chat=${chatId}`);
      return { allowed: false, reason: 'license-invalid' };
    }

    // M11 租户准入：状态 + 配额。isNewChat 必须在 ensureChat 注册前判断。
    const isNewChat = !this.licensedChats.has(chatId);
    const tenantDecision = await this.tenantGate.check(isNewChat);
    if (!tenantDecision.allowed) {
      // 非 strict 下可辨识联合窄化不完美，显式取 reason
      const reason = (tenantDecision as {
        reason: 'tenant-inactive' | 'tenant-chat-limit' | 'tenant-msg-limit';
      }).reason;
      this.logger.warn(`gate blocked (${reason}): chat=${chatId}`);
      return { allowed: false, reason };
    }

    if (await this.licensedChats.ensureChat(chatId, chatName)) return { allowed: true };

    this.logger.warn(`gate blocked (chat-limit ${this.licensedChats.getCount()}/${state.maxChats}): chat=${chatId}`);
    void this.alertOncePerDay(chatId, `群数超限：${chatName || chatId}（${this.licensedChats.getCount()}/${state.maxChats}）`);
    return { allowed: false, reason: 'chat-limit' };
  }

  /**
   * 同一群同一自然日只发一次超限告警。
   * L1 进程内 Map（省一次 Redis 往返 + Redis 故障兜底）；
   * L2 Redis SET NX EX（跨进程/跨重启去重，key 按日分片）。
   * Redis 不可用时退化为仅 L1——告警宁可重复不可漏发。
   */
  private async alertOncePerDay(chatId: string, detail: string): Promise<void> {
    const today = Math.floor(Date.now() / 86_400_000);
    if (this.alertedToday.get(chatId) === today) return;
    this.alertedToday.set(chatId, today);
    // Map 防胀：只保留当天的记录
    for (const [k, v] of this.alertedToday) if (v !== today) this.alertedToday.delete(k);

    try {
      const res = await this.redis.set(
        `license:alert:${chatId}:${today}`,
        '1',
        'EX',
        ALERT_DEDUP_TTL,
        'NX',
      );
      if (res !== 'OK') return; // 已有实例发过当日告警
    } catch (err) {
      this.logger.warn(`alert dedup redis failed, fallback to in-process: ${(err as Error).message}`);
    }

    await this.alertService.sendAlert(detail);
  }
}
