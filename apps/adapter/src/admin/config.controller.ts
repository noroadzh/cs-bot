/** GET /admin/config-check · POST /admin/config/reload · POST /admin/keywords/reload */
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard.js';
import { ConfigService } from '../config/config.service.js';
import { TriggerService } from '../routing/trigger.service.js';
import { maskPII } from '@cs-bot/shared';
import { ConfigCheckDto, ConfigReloadDto, KeywordsReloadDto } from './dto/admin-responses.dto.js';

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
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class ConfigController {
  private readonly cfg = ConfigService.instance;

  constructor(private readonly trigger: TriggerService) {}

  @Get('config-check')
  @ApiOperation({ summary: '配置自检' })
  @ApiResponse({ status: 200, type: ConfigCheckDto, description: '各配置项的存在性与掩码值' })
  @ApiResponse({ status: 401, description: 'Basic Auth 认证失败' })
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
  @ApiOperation({ summary: '重载配置' })
  @ApiResponse({ status: 201, type: ConfigReloadDto, description: '重载成功，返回关键词数量' })
  reload() {
    const count = this.trigger.reload();
    return { reloaded: true, keywords: count };
  }

  @Post('keywords/reload')
  @ApiOperation({ summary: '热重载关键词词典' })
  @ApiResponse({ status: 201, type: KeywordsReloadDto, description: '重载成功' })
  reloadKeywords() {
    const count = this.trigger.reload();
    return { reloaded: true, count };
  }
}
