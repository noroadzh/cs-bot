/**
 * SubscriptionReminder — 订阅到期提醒（概设 §5 M11 订阅管控）
 *
 * T-30/15/7 天提醒租户与运维；通知通道经 Notifier 注入（邮件/群 webhook 可替换）。
 */
import net from 'node:net';
import tls from 'node:tls';
import axios from 'axios';
import { AppLogger } from '../common/logger.js';

export interface Notifier {
  send(target: string, subject: string, body: string): Promise<void>;
}

/** 生产：运维群 webhook；url 为空时仅记日志（开发/测试） */
export class WebhookNotifier implements Notifier {
  constructor(private readonly url: string, private readonly timeoutMs = 5000) {}

  async send(target: string, subject: string, body: string): Promise<void> {
    if (!this.url) return;
    try {
      await axios.post(
        this.url,
        { msgtype: 'text', text: { content: `[${target}] ${subject}\n${body}` } },
        { timeout: this.timeoutMs },
      );
    } catch {
      /* 提醒失败不影响主流程 */
    }
  }
}

export class EmailWebhookNotifier implements Notifier {
  constructor(private readonly url: string, private readonly timeoutMs = 5000) {}

  async send(target: string, subject: string, body: string): Promise<void> {
    if (!this.url) return;
    try {
      await axios.post(
        this.url,
        { to: target, subject, body },
        { timeout: this.timeoutMs },
      );
    } catch {
      /* 邮件网关失败不影响主流程 */
    }
  }
}

const mailLog = new AppLogger('SubscriptionReminder');

/** 未配置 SMTP 也未配置邮件 webhook：只记日志 */
export class LogOnlyNotifier implements Notifier {
  async send(target: string, subject: string): Promise<void> {
    mailLog.warn({ detail: 'mail-not-configured', target, subject });
  }
}

export interface SmtpOptions {
  host: string;
  port: number;
  from: string;
  user?: string;
  password?: string;
  timeoutMs?: number;
}

/** SMTP_HOST 已配置时发信。465 隐式 TLS，其余端口明文，必要时 STARTTLS / AUTH LOGIN */
export class SmtpNotifier implements Notifier {
  constructor(private readonly options: SmtpOptions) {}

  async send(target: string, subject: string, body: string): Promise<void> {
    if (!this.options.host || !target.includes('@')) return;
    try {
      await smtpSend({ ...this.options, to: target, subject, body });
    } catch (err) {
      mailLog.warn({ detail: 'smtp-failed', target, err: (err as Error).message });
    }
  }
}

export class MultiNotifier implements Notifier {
  constructor(private readonly notifiers: readonly Notifier[]) {}

  async send(target: string, subject: string, body: string): Promise<void> {
    await Promise.all(this.notifiers.map((n) => n.send(target, subject, body)));
  }
}

export interface ReminderTenant {
  id: string;
  name: string;
  expiresAt: Date;
  contact?: string | null;
}

export interface DueReminder {
  tenantId: string;
  tenantName: string;
  daysLeft: number;
  stage: 30 | 15 | 7;
  contact?: string | null;
}

const STAGES: readonly (30 | 15 | 7)[] = [30, 15, 7];

export class SubscriptionReminder {
  constructor(
    private readonly tenantMail: Notifier,
    private readonly ops: Notifier = tenantMail,
  ) {}

  dueReminders(tenants: readonly ReminderTenant[], now: Date): DueReminder[] {
    const out: DueReminder[] = [];
    for (const t of tenants) {
      const daysLeft = Math.ceil((t.expiresAt.getTime() - now.getTime()) / 86_400_000);
      const stage = STAGES.find((s) => daysLeft === s);
      if (stage !== undefined) {
        out.push({
          tenantId: t.id,
          tenantName: t.name,
          daysLeft,
          stage,
          contact: t.contact,
        });
      }
    }
    return out;
  }

  /** 发送到期提醒。联系人含 @ 才发租户邮件；运维通道始终通知。返回命中的租户数 */
  async dispatch(
    tenants: readonly ReminderTenant[],
    now: Date,
    opsTarget = 'ops',
  ): Promise<number> {
    const due = this.dueReminders(tenants, now);
    for (const r of due) {
      const contact = (r.contact ?? '').trim();
      if (contact.includes('@')) {
        await this.tenantMail.send(
          contact,
          `订阅即将到期（剩余 ${r.daysLeft} 天）`,
          `租户 ${r.tenantName} 将在 ${r.daysLeft} 天后到期，请及时续费。`,
        );
      }
      await this.ops.send(
        opsTarget,
        `[运营] 租户到期提醒 T-${r.stage}`,
        `${r.tenantName} 剩余 ${r.daysLeft} 天`,
      );
    }
    return due.length;
  }
}

function smtpSend(opts: SmtpOptions & { to: string; subject: string; body: string }): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const implicitTls = opts.port === 465;
  const socket = implicitTls
    ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host })
    : net.connect({ host: opts.host, port: opts.port });
  return runSmtp(socket, opts, timeoutMs, implicitTls);
}

async function runSmtp(
  socket: net.Socket,
  opts: SmtpOptions & { to: string; subject: string; body: string },
  timeoutMs: number,
  implicitTls: boolean,
): Promise<void> {
  const io = smtpIo(socket, timeoutMs);
  try {
    const greet = await io.read();
    if (!greet.startsWith('220')) throw new Error(greet.trim());
    io.write('EHLO cs-bot\r\n');
    let ehlo = await io.read();
    if (!ehlo.startsWith('250')) throw new Error(ehlo.trim());
    if (!implicitTls && /STARTTLS/i.test(ehlo)) {
      io.write('STARTTLS\r\n');
      const ready = await io.read();
      if (!ready.startsWith('220')) throw new Error(ready.trim());
      const secure = tls.connect({ socket, servername: opts.host });
      const secureIo = smtpIo(secure, timeoutMs);
      try {
        await runAuthed(secureIo, opts, true);
      } finally {
        secureIo.close();
      }
      return;
    }
    await runAuthed(io, opts, false);
  } finally {
    io.close();
  }
}

async function runAuthed(
  io: ReturnType<typeof smtpIo>,
  opts: SmtpOptions & { to: string; subject: string; body: string },
  alreadyGreeted: boolean,
): Promise<void> {
  if (alreadyGreeted) {
    io.write('EHLO cs-bot\r\n');
    const ehlo = await io.read();
    if (!ehlo.startsWith('250')) throw new Error(ehlo.trim());
  }
  if (opts.user && opts.password) {
    io.write('AUTH LOGIN\r\n');
    const userPrompt = await io.read();
    if (!userPrompt.startsWith('334')) throw new Error(userPrompt.trim());
    io.write(`${Buffer.from(opts.user).toString('base64')}\r\n`);
    const passPrompt = await io.read();
    if (!passPrompt.startsWith('334')) throw new Error(passPrompt.trim());
    io.write(`${Buffer.from(opts.password).toString('base64')}\r\n`);
    const authed = await io.read();
    if (!authed.startsWith('235')) throw new Error(authed.trim());
  }
  const from = opts.from || 'cs-bot@localhost';
  io.write(`MAIL FROM:<${from}>\r\n`);
  const mail = await io.read();
  if (!mail.startsWith('250')) throw new Error(mail.trim());
  io.write(`RCPT TO:<${opts.to}>\r\n`);
  const rcpt = await io.read();
  if (!rcpt.startsWith('250')) throw new Error(rcpt.trim());
  io.write('DATA\r\n');
  const data = await io.read();
  if (!data.startsWith('354')) throw new Error(data.trim());
  const text = opts.body.replace(/^\./gm, '..');
  io.write(
    `From: ${from}\r\nTo: ${opts.to}\r\nSubject: ${opts.subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n.\r\n`,
  );
  const queued = await io.read();
  if (!queued.startsWith('250')) throw new Error(queued.trim());
  io.write('QUIT\r\n');
}

function smtpIo(socket: net.Socket, timeoutMs: number): {
  read: () => Promise<string>;
  write: (line: string) => void;
  close: () => void;
} {
  let buf = '';
  const waiters: Array<(reply: string) => void> = [];
  let failed: Error | undefined;
  const timer = setTimeout(() => {
    failed = new Error('smtp timeout');
    socket.destroy(failed);
  }, timeoutMs);
  const pump = () => {
    while (waiters.length > 0) {
      const end = smtpReplyEnd(buf);
      if (end < 0) return;
      const reply = buf.slice(0, end);
      buf = buf.slice(end);
      waiters.shift()!(reply);
    }
  };
  socket.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    pump();
  });
  socket.on('error', (err: Error) => {
    failed = err;
    while (waiters.length > 0) waiters.shift()!(`000 ${err.message}`);
  });
  return {
    read: () => new Promise((resolve, reject) => {
      if (failed) {
        reject(failed);
        return;
      }
      waiters.push((reply) => {
        if (reply.startsWith('000')) reject(new Error(reply.slice(4)));
        else resolve(reply);
      });
      pump();
    }),
    write: (line: string) => { socket.write(line); },
    close: () => { clearTimeout(timer); socket.end(); },
  };
}

/** SMTP 多行应答以 `ddd `（空格）结尾 */
function smtpReplyEnd(buf: string): number {
  let offset = 0;
  while (offset < buf.length) {
    const nl = buf.indexOf('\r\n', offset);
    if (nl < 0) return -1;
    const line = buf.slice(offset, nl);
    if (/^\d{3} /.test(line) || !/^\d{3}-/.test(line)) return nl + 2;
    offset = nl + 2;
  }
  return -1;
}
