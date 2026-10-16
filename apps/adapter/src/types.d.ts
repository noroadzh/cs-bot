/**
 * fastify-multipart 自身不带类型声明，
 * 这里补充最小声明以便 NestFactory 与 fastify.register 组合使用。
 */
declare module 'fastify-multipart' {
  import type { FastifyPluginAsync } from 'fastify';
  const fastifyMultipart: FastifyPluginAsync;
  export default fastifyMultipart;
}
