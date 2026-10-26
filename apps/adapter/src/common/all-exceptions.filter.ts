/**
 * 全局异常过滤器
 *
 * - HttpException：记录 warn（errCode/status/上下文），保持原响应体与状态码。
 * - 未预期异常：记录 error（含 stack），对外返回 500 统一体，不泄露堆栈。
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppLogger } from './logger.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new AppLogger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = isHttp ? exception.getResponse() : undefined;

    let body: Record<string, unknown>;
    if (isHttp) {
      body = typeof raw === 'string' ? { errCode: raw } : (raw as Record<string, unknown>);
    } else {
      body = { errCode: 'INTERNAL_ERROR', detail: 'internal server error' };
    }
    const errCode = body?.errCode;

    if (status >= 500) {
      this.logger.error({
        method: req.method,
        path: req.path,
        status,
        errCode,
        err: (exception as Error)?.message,
        stack: (exception as Error)?.stack,
      });
    } else {
      this.logger.warn({ method: req.method, path: req.path, status, errCode });
    }

    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
