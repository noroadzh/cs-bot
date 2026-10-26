/**
 * 应用启动入口
 * 启动顺序：Config(同步就绪) → Redis 探活 → PG 探活 → HTTP 监听
 *
 * 可观测性：进程级兜底日志（uncaughtException/unhandledRejection）、
 * 启动阶段日志、SIGTERM/SIGINT 优雅关闭日志、HTTP 访问日志中间件。
 */
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from './config/config.service.js';
import { LicenseService } from './license/license.service.js';
import { AppModule } from './app.module.js';
import { AppLogger } from './common/logger.js';
import { httpLoggingMiddleware } from './common/http-logging.middleware.js';
import { Redis } from 'ioredis';
import { SWAGGER_UI_PATH, OPENAPI_JSON_PATH } from './common/docs-paths.js';

const logger = new AppLogger('Bootstrap');

// 进程级兜底：未捕获异常 / 未处理 Promise rejection 落 fatal 日志（不静默退出）
process.on('uncaughtException', (err) => {
  logger.error({ phase: 'fatal', detail: 'uncaughtException', err: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error({
    phase: 'fatal',
    detail: 'unhandledRejection',
    err: (reason as Error)?.message ?? String(reason),
  });
});

async function bootstrap() {
  // 配置必须在 providers 构造前就绪（构造期会读 ConfigService.instance）
  ConfigService.initialize();
  const config = ConfigService.instance;
  logger.log({
    phase: 'start',
    detail: 'bootstrap',
    version: process.env.APP_VERSION || 'dev',
    env: process.env.NODE_ENV || 'development',
    PORT: config.PORT,
    HOST: config.HOST,
  });

  // 1) Redis 探活
  let redis: Redis | null = null;
  try {
    redis = new Redis({ host: config.REDIS_HOST, port: config.REDIS_PORT, password: config.REDIS_PASSWORD || undefined, lazyConnect: true, connectTimeout: 3000 });
    await redis.ping();
    logger.log({ phase: 'ready', detail: 'redis' });
  } catch (err) {
    logger.error({ phase: 'error', detail: 'redis-ping', err: (err as Error).message });
    process.exit(1);
  } finally {
    redis?.disconnect();
  }

  // 2) PG 探活（延迟导入避免 NestJS 未就绪）
  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 3000 });
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    logger.log({ phase: 'ready', detail: 'postgresql' });
  } catch (err) {
    logger.error({ phase: 'error', detail: 'postgresql-ping', err: (err as Error).message });
    process.exit(1);
  }

  // 3) 创建应用 + 全局中间件（访问日志/traceId）
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.use(httpLoggingMiddleware);
  app.enableShutdownHooks();

  if (config.SWAGGER_ENABLED) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CS Bot API')
      .setDescription('微信群智能客服机器人管理接口')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(SWAGGER_UI_PATH, app, document);
    app.getHttpAdapter().get(OPENAPI_JSON_PATH, (_req: unknown, res: { json: (b: unknown) => void }) => {
      res.json(document);
    });
    logger.log({ phase: 'ready', detail: `swagger-ui at /${SWAGGER_UI_PATH}, openapi json at ${OPENAPI_JSON_PATH}` });
  }

  const PORT = config.PORT ?? 3000;
  const HOST = config.HOST ?? '0.0.0.0';
  await app.listen(PORT, HOST);
  logger.log({ phase: 'ready', detail: 'http listen', PORT, HOST });

  // 优雅关闭日志
  const shutdown = async (signal: string) => {
    logger.log({ phase: 'shutdown', detail: signal });
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ phase: 'fatal', detail: 'bootstrap', err: (err as Error)?.message, stack: (err as Error)?.stack });
  process.exit(1);
});
