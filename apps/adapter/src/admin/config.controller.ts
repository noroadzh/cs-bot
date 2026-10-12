/** GET /admin/config-check · POST /admin/config/reload · POST /admin/keywords/reload */
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { ConfigService } from '../config/config.service.js';
import { TriggerService } from '../routing/trigger.service.js';
import { maskPII } from '@cs-bot/shared';

const SECRET_KEYS = [
  'WECHAT_AGENT_SECRET', 'WECHAT_TOKEN', 'WECHAT_ENCODING_AES_KEY',
  'FASTGPT_API_KEY', 'LLM_PRIMARY_API_KEY', 'LLM_FALLBACK_API_KEY',
  'ADMIN_PASSWORD', 'REDIS_PASSWORD', 'DATABASE_URL',
];

const ALL_KEYS = [
  ...SECRET_KEYS,
  'WECHAT_CORP_ID', 'WECHAT_AGENT_ID', 'FASTGPT_BASE_URL',
  'LLM_PRIMARY_BASE_URL', 'LLM_FALLBACK_BASE_URL', 'ADMIN_USER',
  'LICENSE_FILE', 'USAGE_REPORT_ENABLED',
];

@Controller('admin')
@UseGuards(AdminGuard)
export class ConfigController {
  private readonly cfg = ConfigService.instance;

  constructor(private readonly trigger: TriggerService) {}

  @Get('config-check')
  check() {
    const check: Record<string, { present: boolean; masked?: string }> = {};
    for (const k of ALL_KEYS) {
      const v = process.env[k];
      check[k] = {
        present: v !== undefined && v !== '',
        masked: SECRET_KEYS.includes(k) && v ? maskPII(v, 'generic') : undefined,
      };
    }
    return {
      mode: { useMockLlm: this.cfg.USE_MOCK_LLM, useMockLicense: this.cfg.USE_MOCK_LICENSE },
      config: check,
    };
  }

  @Post('config/reload')
  reload() {
    const count = this.trigger.reload();
    return { reloaded: true, keywords: count };
  }

  @Post('keywords/reload')
  reloadKeywords() {
    const count = this.trigger.reload();
    return { reloaded: true, count };
  }
}
