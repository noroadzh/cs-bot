/**
 * LicensedChatService：license 群数上限管理
 *
 * M9 群数上限：license 中 maxChats 限制激活机器人的群数。
 * - 启动时 load() 从 PG 全量加载已激活群到内存 Set
 * - ensureChat(chatId, chatName)：已注册 → true；未注册且未超限 → 注册并 true；
 *   超限 → false
 * - removeChat(chatId)：退群删除记录，释放名额
 *
 * maxChats <= 0 视为不限制（mock license 无该字段时为 0）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { LicenseService } from './license.service.js';
import axios from 'axios';

@Injectable()
export class LicensedChatService {
  private readonly logger = new Logger('LicensedChat');
  private readonly pool: Pool;
  private readonly chatIds = new Set<string>();
  private loaded = false;
  private readonly alerted = new Map<string, number>();

  constructor(private readonly licenseService: LicenseService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  /** 启动时从 PG 加载已激活群（由 startup 流程调用；失败视为空集） */
  async load(): Promise<void> {
    try {
      const res = await this.pool.query<{ chat_id: string }>('SELECT chat_id FROM licensed_chat');
      this.chatIds.clear();
      for (const row of res.rows) this.chatIds.add(row.chat_id);
      this.loaded = true;
      this.logger.log(`licensed chats loaded: ${this.chatIds.size}`);
    } catch (err) {
      // 表可能还不存在（首次部署未跑 DDL），视为空集，消息路径照常走注册流程
      this.logger.warn(`licensed_chat load failed (treat as empty): ${(err as Error).message}`);
      this.loaded = true;
    }
  }

  /** 当前激活群数 */
  getCount(): number {
    return this.chatIds.size;
  }

  /** 是否已注册（内存判断，消息路径 O(1)） */
  has(chatId: string): boolean {
    return this.chatIds.has(chatId);
  }

  /**
   * 确保群已注册；未注册且未超限时注册。
   * @returns true=放行；false=超限拒绝
   */
  async ensureChat(chatId: string, chatName = ''): Promise<boolean> {
    if (this.chatIds.has(chatId)) return true;
    if (!this.canAdd()) {
      void this.alertChatLimit(chatId);
      return false;
    }
    try {
      await this.pool.query(
        `INSERT INTO licensed_chat (chat_id, chat_name) VALUES ($1, $2)
         ON CONFLICT (chat_id) DO UPDATE SET chat_name = EXCLUDED.chat_name`,
        [chatId, chatName],
      );
      this.chatIds.add(chatId);
      this.logger.log(`chat registered: ${chatId} (${this.chatIds.size}/${this.getMaxChats() || '∞'})`);
      return true;
    } catch (err) {
      // PG 不可用时放行，不因授权库故障阻断消息（故障在 load 时已有 warn）
      this.logger.error(`chat register failed (allow): ${(err as Error).message}`);
      return true;
    }
  }

  /** 退群释放名额 */
  async removeChat(chatId: string): Promise<void> {
    try {
      await this.pool.query('DELETE FROM licensed_chat WHERE chat_id = $1', [chatId]);
    } catch (err) {
      this.logger.error(`chat remove failed: ${(err as Error).message}`);
      return;
    }
    this.chatIds.delete(chatId);
    this.logger.log(`chat removed: ${chatId} (${this.chatIds.size} left)`);
  }

  private async alertChatLimit(chatId: string): Promise<void> {
    const last = this.alerted.get(chatId) ?? 0;
    if (Date.now() - last < 86_400_000) return;
    this.alerted.set(chatId, Date.now());
    const url = ConfigService.instance.OPS_WEBHOOK_URL ?? '';
    if (!url) return;
    try {
      await axios.post(
        url,
        { msgtype: 'text', text: { content: `[授权告警] 群 ${chatId} 超出 license maxChats=${this.getMaxChats()}，已拒绝接入` } },
        { timeout: 5000 },
      );
    } catch (err) {
      this.logger.warn(`chat-limit alert failed: ${(err as Error).message}`);
    }
  }

  private canAdd(): boolean {
    const max = this.getMaxChats();
    return max <= 0 || this.chatIds.size < max;
  }

  private getMaxChats(): number {
    return this.licenseService.getState().maxChats;
  }
}
