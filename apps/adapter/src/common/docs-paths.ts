/**
 * Swagger / OpenAPI 挂载路径常量
 *
 * 独立成模块的原因：main.ts 顶层会执行 bootstrap()（Redis/PG 探活 + exit(1)），
 * 契约测试无法 import 它取常量。测试与 main.ts 都从这里读，保证同源。
 */

/** Swagger UI 的挂载路径（SwaggerModule.setup 的第一个参数） */
export const SWAGGER_UI_PATH = 'docs';

/** 原始 OpenAPI JSON 的挂载路径。
 *  SwaggerModule.setup('docs') 会自动占用 /docs 与 /docs-json，
 *  故 JSON 端点用 /docs 子路径避开冲突，供 CI 契约校验与 curl 排查使用。 */
export const OPENAPI_JSON_PATH = '/docs/openapi.json';
