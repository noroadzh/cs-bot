/**
 * 通用 pino logger 包装
 * 结构化 JSON：app/version/env/pid + module + traceId（请求内自动）+ 脱敏。
 * 可选 LOG_FILE 文件落盘（与 stdout 双写，供无 SSH 场景排查）。
 */
import pino from 'pino';
import { currentTraceId } from './request-context.js';

const APP = 'cs-bot-adapter';
const VERSION = process.env.APP_VERSION || 'dev';
const ENV = process.env.NODE_ENV || 'development';

/** 日志脱敏路径：正文/密钥/token/授权等 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'authorization',
  'password',
  '*.password',
  'secret',
  '*.secret',
  'token',
  '*.token',
  'licenseKey',
  '*.licenseKey',
  'answer',
  '*.answer',
  'answerRaw',
  '*.answerRaw',
  'question',
  '*.question',
  'content',
  '*.content',
];

function buildRoot(): pino.Logger {
  const level = process.env.LOG_LEVEL || 'info';
  const options: pino.LoggerOptions = {
    level,
    base: { app: APP, version: VERSION, env: ENV, pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  };

  const logFile = process.env.LOG_FILE || '';
  if (logFile) {
    const streams = [
      { level: level as pino.Level, stream: process.stdout },
      { level: level as pino.Level, stream: pino.destination({ dest: logFile, sync: false }) },
    ];
    return pino(options, pino.multistream(streams));
  }
  return pino(options);
}

export class AppLogger {
  /** 共享 pino root（供 pino-http 等复用） */
  static readonly root: pino.Logger = buildRoot();

  constructor(private readonly module: string) {}

  private child(extra: Record<string, unknown> = {}): pino.Logger {
    const traceId = currentTraceId();
    return AppLogger.root.child({
      module: this.module,
      ...(traceId ? { traceId } : {}),
      ...extra,
    });
  }

  log(payload: Record<string, unknown>) {
    this.child().info(payload);
  }

  warn(payload: Record<string, unknown>) {
    this.child().warn(payload);
  }

  error(payload: Record<string, unknown>) {
    this.child().error(payload);
  }

  debug(payload: Record<string, unknown>) {
    this.child().debug(payload);
  }

  /** 记录耗时；超过 SLOW_LOG_MS 打 slow 标记 */
  timing(payload: Record<string, unknown>, costMs: number) {
    const slow = costMs >= Number(process.env.SLOW_LOG_MS || 2000);
    this.child(slow ? { slow: true } : {}).info({ ...payload, costMs });
  }
}
