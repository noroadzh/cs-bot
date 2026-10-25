/**
 * 应用启动入口
 * 启动顺序：Config → License → Redis 探活 → PG 探活 → 监听
 */
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from './config/config.service.js';
import { LicenseService } from './license/license.service.js';
import { AppModule } from './app.module.js';
import { AppLogger } from './common/logger.js';
import { Redis } from 'ioredis';
import { SWAGGER_UI_PATH, OPENAPI_JSON_PATH } from './common/docs-paths.js';

async function bootstrap() {
  const logger = new AppLogger('Bootstrap');

  // D8 启动顺序
  // 1. ConfigService 已在 AppModule.onModuleInit 中执行 fail-fast
  // 2. LicenseService 已在 AppModule.onModuleInit 中执行首次校验
  // 3. Redis 探活
  const config = ConfigService.instance;
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

  // 4. PG 探活（延迟导入避免 NestJS 未就绪）
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

  // 5. 注册全局异常过滤器，初始化 Swagger，启动 HTTP
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  if (config.SWAGGER_ENABLED) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CS Bot API')
      .setDescription('微信群智能客服机器人管理接口')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(SWAGGER_UI_PATH, app, document);
    // 原始 OpenAPI JSON 独立挂一处，供 CI 契约校验与 curl 排查使用
    // （SwaggerModule.setup 会占用 /docs-json，这里用 /docs/openapi.json 避开）
    app.getHttpAdapter().get(OPENAPI_JSON_PATH, (_req: unknown, res: { json: (b: unknown) => void }) => {
      res.json(document);
    });
    logger.log({ phase: 'ready', detail: `swagger-ui at /${SWAGGER_UI_PATH}, openapi json at ${OPENAPI_JSON_PATH}` });
  }

  const PORT = config.PORT ?? 3000;
  const HOST = config.HOST ?? '0.0.0.0';
  await app.listen(PORT, HOST);
  logger.log({ phase: 'ready', detail: `http listen`, PORT, HOST });
}

bootstrap().catch((err) => {
  console.error('[Bootstrap.Fatal]', err);
  process.exit(1);
});
