/**
 * 独立控制面进程入口（SaaS 形态）
 *
 * 与数据面 adapter 共用同一镜像，但只挂载 PlatformModule：
 * 独立端口、独立数据库、独立鉴权；不加载企微/FastGPT/问答链路。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from './config/config.service.js';
import { ControlPlaneAppModule } from './control-plane/control-plane-app.module.js';
import { loadControlPlaneConfig } from './control-plane/control-plane.config.js';

async function bootstrap(): Promise<void> {
  const cfg = loadControlPlaneConfig();
  (ConfigService as unknown as { _instance: unknown })._instance = cfg;

  const app = await NestFactory.create(ControlPlaneAppModule);
  app.enableShutdownHooks();
  await app.listen(cfg.PORT, cfg.HOST);
  console.log(`[control-plane] listening on ${cfg.HOST}:${cfg.PORT}`);

  const shutdown = async (signal: string) => {
    console.log(`[control-plane] ${signal} received, closing`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
