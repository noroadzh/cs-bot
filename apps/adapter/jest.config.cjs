/** @type {import('jest').Config} */
module.exports = {
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@cs-bot/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@cs-bot/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1.js',
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
    '!**/*.module.ts',
    '!**/main.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 55,
      functions: 70,
      lines: 75,
      statements: 75,
    },
  },
  testMatch: ['**/test/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  passWithNoTests: true,
  setupFiles: ['<rootDir>/test/__setup__/env.ts'],
};
