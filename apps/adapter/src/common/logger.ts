/**
 * 通用 pino logger 包装
 * 内置结构化字段：traceId/chatId/userIdHash/msgType/errCode/costMs
 */
import pino from 'pino';

export class AppLogger {
  private static root: pino.Logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { app: 'cs-bot-adapter' },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });

  constructor(private readonly module: string) {}

  private child(bindings: Record<string, unknown>): pino.Logger {
    return AppLogger.root.child({ module: this.module, ...bindings });
  }

  log(payload: Record<string, unknown>) {
    this.child({}).info(payload);
  }

  warn(payload: Record<string, unknown>) {
    this.child({}).warn(payload);
  }

  error(payload: Record<string, unknown>) {
    this.child({}).error(payload);
  }

  debug(payload: Record<string, unknown>) {
    this.child({}).debug(payload);
  }
}
