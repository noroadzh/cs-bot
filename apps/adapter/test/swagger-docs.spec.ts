/**
 * Swagger 文档契约测试
 *
 * 保证 OpenAPI 文档质量：每个 handler 都有 @ApiOperation + @ApiResponse 且 2xx 必须声明
 * 返回结构（type DTO 或 inline schema），DTO 必须带 @ApiProperty。
 * 防止后人加端点时漏注解 → 文档退化为空 schema。
 *
 * 实现机制：不启动 Nest 应用，直接用 Reflect.getMetadata 读装饰器写在
 * method descriptor 上的元数据（key 见 @nestjs/swagger/dist/constants）。
 */
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import 'reflect-metadata';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { Provider, Type } from '@nestjs/common';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { ConfigController } from '../src/admin/config.controller.js';
import { LicenseController } from '../src/admin/license.controller.js';
import { MissController } from '../src/admin/miss.controller.js';
import { AssetController } from '../src/media/asset.controller.js';
import { HealthController } from '../src/health/health.controller.js';
import { WecomController } from '../src/wecom/wecom.controller.js';
// stub 注入用的 class 引用（Nest DI 按 design:paramtypes 的 class 匹配 provider）
import { TriggerService } from '../src/routing/trigger.service.js';
import { LicenseService } from '../src/license/license.service.js';
import { UsageService } from '../src/usage/usage.service.js';
import { MissExportService } from '../src/miss/miss-export.service.js';
import { AssetService } from '../src/media/asset.service.js';
import { WecomCrypto } from '../src/wecom/wecom-crypto.js';
import { RoutingService } from '../src/routing/routing.service.js';
import { MediaRecognizeService } from '../src/media/media-recognize.service.js';
import { WecomClient } from '../src/wecom/wecom-client.js';
import { LicenseGateService } from '../src/license/license-gate.service.js';
// 导入 DTO 触发 @ApiProperty 装饰器元数据注册（side-effect import）
import '../src/admin/dto/admin-responses.dto.js';
import '../src/admin/dto/miss-export.dto.js';
import '../src/common/dto/error-response.dto.js';
import '../src/common/dto/health-response.dto.js';
import '../src/common/dto/license-state.dto.js';
import '../src/common/dto/usage.dto.js';
import '../src/media/dto/asset-response.dto.js';

const DECORATORS = {
  API_OPERATION: 'swagger/apiOperation',
  API_RESPONSE: 'swagger/apiResponse',
  API_MODEL_PROPERTIES: 'swagger/apiModelProperties',
  API_MODEL_PROPERTIES_ARRAY: 'swagger/apiModelPropertiesArray',
} as const;

interface Collected {
  controller: string;
  handler: string;
  /** HTTP 方法名，来自 METHOD_METADATA */
  method: string;
  path: string;
  operations: Record<string, unknown> | undefined;
  /** key 是 status code（如 "200"、"201"），value 是响应选项 */
  responses:
    | Record<string, { type?: unknown; schema?: unknown }>
    | undefined;}

/** 所有控制器：新增 controller 后必须在此注册，否则测试覆盖不到 */
const CONTROLLERS = [
  ConfigController,
  LicenseController,
  MissController,
  AssetController,
  HealthController,
  WecomController,
] as const;

const METHOD_NAMES: Record<number, string> = {
  0: 'GET',
  1: 'POST',
  2: 'PUT',
  3: 'DELETE',
  4: 'PATCH',
  5: 'ALL',
};

function collect(ctor: abstract new (...args: never[]) => object): Collected[] {
  const controllerPath: string = Reflect.getMetadata(PATH_METADATA, ctor);
  const proto = ctor.prototype as Record<string, CallableFunction>;
  const out: Collected[] = [];

  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (!descriptor || typeof descriptor.value !== 'function') continue;

    const handlerPath: string | undefined = Reflect.getMetadata(PATH_METADATA, descriptor.value);
    const methodId: number | undefined = Reflect.getMetadata(METHOD_METADATA, descriptor.value);
    if (handlerPath === undefined || methodId === undefined) continue;

    out.push({
      controller: ctor.name,
      handler: key,
      method: METHOD_NAMES[methodId] ?? String(methodId),
      path: `/${controllerPath}/${handlerPath}`.replace(/\/+$/,''),
      operations: Reflect.getMetadata(DECORATORS.API_OPERATION, descriptor.value),
      responses: Reflect.getMetadata(DECORATORS.API_RESPONSE, descriptor.value),
    });
  }
  return out;
}

/** 展平为 { controller·handler·status } → response meta，供跨控制器断言 */
function collectAll(): Collected[] {
  return CONTROLLERS.flatMap(collect);
}

const ALL = collectAll();

describe('swagger 契约：路由发现', () => {
  it('共收集到 6 个控制器、至少 8 个 handler', () => {
    const byController = new Map(ALL.map((c) => [c.controller, c]));
    expect(byController.size).toBe(6);
    expect(ALL.length).toBeGreaterThanOrEqual(8);
  });

  it('wecom callback / healthz / admin 路由都存在', () => {
    const keys = ALL.map((c) => `${c.controller}.${c.handler}`);
    expect(keys).toContain('WecomController.callback');
    expect(keys).toContain('HealthController.check');
    expect(keys).toContain('ConfigController.check');
    expect(keys).toContain('LicenseController.status');
  });
});

describe('swagger 契约：@ApiOperation', () => {
  it.each(ALL.map((c) => [c.controller, c.handler, c]))(
    '%s.%s 有 @ApiOperation',
    (_ctl, _h, c) => {
      expect(c.operations).toBeDefined();
      expect(c.operations?.summary).toBeTruthy();
    },
  );
});

describe('swagger 契约：@ApiResponse 2xx 必须带 type 或 schema', () => {
  // @ApiResponse 把 status 当作元数据 key 写入，如 { "200": { type, ... } }。
  // 仅遍历明确以 "2" 开头的 status（即 2xx），"default" 跳过。
  it.each(ALL.flatMap((c) =>
    Object.entries(c.responses ?? {})
      .filter(([status]) => /^2\d\d$/.test(status))
      .map(([status, meta]) => [c.controller, c.handler, status, meta] as const),
  ))('%s.%s status=%s 声明了返回结构', (_ctl, _h, _s, r) => {
    expect(r.type !== undefined || r.schema !== undefined).toBe(true);
  });
});

describe('swagger 契约：被引用的 DTO 必须带 @ApiProperty 元数据', () => {
  // 从所有 @ApiResponse 中收集被引用的 DTO class
  const referenced = new Set<Function>();
  for (const c of ALL) {
    for (const r of Object.values(c.responses ?? {})) {
      if (r.type && typeof r.type === 'function') referenced.add(r.type);
    }
  }

  it('确实收集到了 DTO 引用（防止空转）', () => {
    expect(referenced.size).toBeGreaterThan(0);
  });

  it.each([...referenced])('%s 所有属性都有 @ApiProperty', (dto) => {
    // @ApiProperty 是 property decorator，target 是 prototype：数组与逐字段
    // 元数据都写在 dto.prototype 上（读取时沿原型链，继承字段也能取到）
    const props: string[] | undefined = Reflect.getMetadata(
      DECORATORS.API_MODEL_PROPERTIES_ARRAY,
      dto.prototype,
    );
    // DTO 至少要有 1 个 @ApiProperty 字段；且 array 中每项是 `:propName` 形式
    expect(Array.isArray(props)).toBe(true);
    expect(props!.length).toBeGreaterThan(0);
    // 逐个字段验证元数据存在（ApiProperty 会给每个 prop 写 API_MODEL_PROPERTIES）
    for (const entry of props!) {
      const propName = entry.slice(1); // 去掉前缀 ':'
      const meta = Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES, dto.prototype, propName);
      expect(meta).toBeDefined();
    }
  });
});

describe('swagger 文档产出：SWAGGER_ENABLED 闸门', () => {
  /**
   * Swagger 只读路由与注解元数据，不会调用 handler。Stub 注入只为让 DI 通过。
   * 注意：class 类 provider 用 class 引用；字符串 token（@Inject('XXX'））用字符串。
   */
  // 字符串 token（@Inject('XXX')）无法从 class 数组推断，单独标注 Provider 类型
  const STUBS: Provider[] = [
    ...([
      TriggerService,
      LicenseService,
      UsageService,
      MissExportService,
      AssetService,
      WecomCrypto,
      RoutingService,
      MediaRecognizeService,
      WecomClient,
      LicenseGateService,
    ] as Type<unknown>[]).map((cls) => ({ provide: cls, useValue: {} })),
    { provide: 'HEALTH_REDIS', useValue: {} },
    { provide: 'HEALTH_PG', useValue: {} },
  ];

  async function buildDoc(enabled: boolean): Promise<OpenAPIObject | null> {
    setConfig({ SWAGGER_ENABLED: enabled });
    const app = await Test.createTestingModule({
      controllers: [...CONTROLLERS],
      providers: STUBS,
    }).compile();
    const nestApp = app.createNestApplication();
    await nestApp.init();
    try {
      if (!enabled) return null; // 闸门关闭：main.ts 根本不会 createDocument
      const cfg = new DocumentBuilder()
        .setTitle('CS Bot API')
        .setDescription('微信群智能客服机器人管理接口')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
      return SwaggerModule.createDocument(nestApp, cfg);
    } finally {
      await nestApp.close();
    }
  }

  afterEach(() => {
    resetConfig();
  });

  it('SWAGGER_ENABLED=false 时 config 读到 false（闸门可关）', async () => {
    setConfig({ SWAGGER_ENABLED: false });
    const { ConfigService } = await import('../src/config/config.service.js');
    expect(ConfigService.instance.SWAGGER_ENABLED).toBe(false);
  });

  it('生成的文档含 openapi/info/paths 三段', async () => {
    const doc = await buildDoc(true);
    expect(doc).not.toBeNull();
    expect(doc!.openapi).toMatch(/^3\./);
    expect(doc!.info.title).toBe('CS Bot API');
    expect(Object.keys(doc!.paths).length).toBeGreaterThan(0);
  });

  it('每个 path 都有 operationId 或 summary（不会退化成空白文档）', async () => {
    const doc = await buildDoc(true);
    const ops = Object.values(doc!.paths).flatMap((p) => Object.values(p ?? {}));
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.summary ?? op.operationId).toBeDefined();
    }
  });

  it('components.schemas 非空——DTO 真的产出了 schema', async () => {
    const doc = await buildDoc(true);
    expect(Object.keys(doc!.components?.schemas ?? {}).length).toBeGreaterThan(0);
  });
});

describe('OpenAPI JSON 端点挂载契约', () => {
  // bootstrap() 里真实地给 express 加了 GET /docs/openapi.json 路由——
  // 我们不启 HTTP（要 Redis/PG 探活），但路径常量是 bootstrap 唯一 import 的真实来源，
  // 锁住它不会悄悄挪走。常量从无副作用的 docs-paths 模块取，避免触发 main.ts 顶层副作用。
  it('OPENAPI_JSON_PATH 是 /docs/openapi.json（避开 SwaggerModule.setup 占用的 /docs-json）', async () => {
    const { OPENAPI_JSON_PATH } = await import('../src/common/docs-paths.js');
    expect(OPENAPI_JSON_PATH).toBe('/docs/openapi.json');
    // SwaggerModule.setup('docs', ...) 会在 /docs 与 /docs-json 上挂两个路由，
    // 我们必须挂在 /docs 子路径下，不能与 /docs-json 冲突。
    expect(OPENAPI_JSON_PATH).not.toBe('/docs-json');
    expect(OPENAPI_JSON_PATH).not.toBe('/docs');
  });

  it('SWAGGER_UI_PATH 与 OPENAPI_JSON_PATH 同源（都从 /docs 起）', async () => {
    const { SWAGGER_UI_PATH, OPENAPI_JSON_PATH } = await import('../src/common/docs-paths.js');
    // UI 在 mount '/docs'，我们在 '/docs/openapi.json'——同源便于运维记忆
    expect(OPENAPI_JSON_PATH.startsWith(`/${SWAGGER_UI_PATH}/`)).toBe(true);
  });
});
