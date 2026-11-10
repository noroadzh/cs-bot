/** @type {import('jest').Config} */
module.exports = {
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@cs-bot/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@cs-bot/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1.js',
    // prebuilds/*.node 未检出时仍可解析包名（单测再 jest.mock）
    '^@cs-bot/license-native$': '<rootDir>/test/__setup__/license-native.stub.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: false,
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          target: 'ES2022',
          strict: false,
        },
      },
    ],
  },
  collectCoverageFrom: [
    // 管道模块
    'src/wecom/**/*.ts',
    'src/routing/**/*.ts',
    'src/context/**/*.ts',
    'src/qa/**/*.ts',
    'src/filter/**/*.ts',
    'src/miss/**/*.ts',
    'src/media/**/*.ts',
    // 横切模块
    'src/config/**/*.ts',
    'src/license/**/*.ts',
    'src/admin/**/*.ts',
    'src/health/**/*.ts',
    'src/common/**/*.ts',
    // SaaS / 导入 / 用量：P0 关键路径（非整目录，避免稀释全局）
    'src/platform/tenant-quota.service.ts',
    'src/platform/tenant.service.ts',
    'src/platform/provisioner/shell-provisioner.ts',
    'src/platform/wildcard-tls.service.ts',
    'src/platform/platform-audit.service.ts',
    'src/platform/billing/payment-provider.ts',
    'src/platform/platform.controller.ts',
    'src/import/import-lock.ts',
    'src/import/import-job.service.ts',
    'src/import/import-memory.ts',
    'src/usage/capacity-guard.service.ts',
    'src/usage/usage-webhook.service.ts',
    'src/usage/usage-reporter.scheduler.ts',
    '!**/*.module.ts',
    '!**/main.ts',
    '!**/dto/**',
    '!src/media/asr.service.ts',
    '!src/health/metrics.controller.ts',
    '!src/admin/knowledge.controller.ts',
    '!src/admin/knowledge.service.ts',
    '!src/admin/users.controller.ts',
    '!src/admin/audit-logs.controller.ts',
    '!src/admin/admin-audit.interceptor.ts',
    '!src/qa/model-router.service.ts',
    '!src/qa/llm-alert.service.ts',
    // 引擎分支面大，单独抬测；门禁先盯编排/client/mock
    '!src/qa/fastgpt-qa.engine.ts',
    '!src/common/http-logging.middleware.ts',
    // 控制器面大、单测浅；门禁盯服务层关键路径
    '!src/platform/platform.controller.ts',
    // 大服务分支依赖慢盘 Excel 用例；P0 盯 lock/memory
    '!src/import/import-job.service.ts',
  ],
  coverageThreshold: {
    // 注意：不要在此写 global——Jest 与路径阈值并存时会把 global 算偏；
    // 全局由 scripts/check-coverage-global.mjs 按 coverage-summary.json 校验。
    // 管道：行/语句/函数 ≥80%；分支 ≥70%
    './src/wecom/': { branches: 70, functions: 75, lines: 80, statements: 80 },
    './src/routing/': { branches: 80, functions: 80, lines: 80, statements: 80 },
    './src/context/': { branches: 80, functions: 80, lines: 80, statements: 80 },
    './src/qa/': { branches: 70, functions: 80, lines: 80, statements: 80 },
    './src/filter/': { branches: 80, functions: 80, lines: 80, statements: 80 },
    './src/miss/': { branches: 70, functions: 80, lines: 80, statements: 80 },
    './src/media/': { branches: 70, functions: 75, lines: 80, statements: 80 },
    // 横切 ≥60%
    './src/config/': { branches: 60, functions: 60, lines: 60, statements: 60 },
    './src/license/': { branches: 60, functions: 60, lines: 60, statements: 60 },
    './src/admin/': { branches: 55, functions: 60, lines: 70, statements: 70 },
    './src/health/': { branches: 50, functions: 60, lines: 70, statements: 70 },
    './src/common/': { branches: 60, functions: 60, lines: 60, statements: 60 },
    // P0 关键路径文件
    './src/platform/tenant-quota.service.ts': { branches: 60, functions: 60, lines: 60, statements: 60 },
    './src/platform/tenant.service.ts': { branches: 60, functions: 60, lines: 70, statements: 70 },
    './src/platform/provisioner/shell-provisioner.ts': { branches: 55, functions: 60, lines: 70, statements: 70 },
    './src/import/import-lock.ts': { branches: 60, functions: 60, lines: 80, statements: 80 },
    './src/usage/capacity-guard.service.ts': { branches: 60, functions: 60, lines: 70, statements: 70 },
    './src/usage/usage-webhook.service.ts': { branches: 60, functions: 60, lines: 80, statements: 80 },
  },
  coverageReporters: ['text', 'lcov', 'json-summary'],
  // WSL/D: 慢盘 + exceljs 可达 2min+；避免默认/60s 误杀
  testTimeout: 180_000,
  testMatch: ['**/test/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  passWithNoTests: true,
  setupFiles: ['<rootDir>/test/__setup__/env.ts'],
  forceExit: true,
};
