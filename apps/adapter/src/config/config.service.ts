/**
 * 配置服务
 * 单例 + fail-fast 启动；属性访问直接返回已校验配置值
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import { AppConfigSchema, type AppConfigInput } from './config.schema.js';
import { AppLogger } from '../common/logger.js';

loadDotenv();

/** 属性代理：config.WECHAT_TOKEN 等直接读已校验值 */
@Injectable()
export class ConfigService implements OnModuleInit {
  private static _instance: AppConfigInput;
  private readonly logger = new AppLogger('ConfigService');

  static get instance(): AppConfigInput {
    if (!ConfigService._instance) {
      throw new Error('ConfigService not initialized yet');
    }
    return ConfigService._instance;
  }

  onModuleInit() {
    const result = AppConfigSchema.safeParse(process.env);
    if (!result.success) {
      console.error('[ConfigService] 环境变量校验失败：');
      console.error(JSON.stringify(result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })), null, 2));
      process.exit(1);
    }
    ConfigService._instance = result.data;
    this.logger.log({ phase: 'ready', detail: 'config', mock: result.data.USE_MOCK_LLM });
  }
}