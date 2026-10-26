/**
 * HTTP 访问日志中间件（express 全局）
 *
 * 为每个请求生成/透传 traceId，写入 AsyncLocalStorage 与 X-Request-Id 响应头；
 * 请求结束记录 method/path/status/costMs/ip/ua。healthz/docs 降级到 debug。
 */
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppLogger } from './logger.js';
import { requestContext } from './request-context.js';

const logger = new AppLogger('HTTP');

export function httpLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerId = req.headers['x-request-id'];
  const traceId = (Array.isArray(headerId) ? headerId[0] : headerId) || randomUUID();
  res.setHeader('X-Request-Id', traceId);
  const start = Date.now();
  const httpLogEnabled = process.env.LOG_HTTP !== 'false';

  requestContext.run({ traceId }, () => {
    if (httpLogEnabled) {
      res.on('finish', () => {
        const costMs = Date.now() - start;
        const payload = {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          costMs,
          ip: req.ip,
          ua: req.headers['user-agent'],
        };
        const isQuiet = req.path === '/healthz' || req.path.startsWith('/docs');
        if (isQuiet) logger.debug(payload);
        else if (res.statusCode >= 500) logger.error(payload);
        else if (res.statusCode >= 400) logger.warn(payload);
        else logger.log(payload);
      });
    }
    next();
  });
}
