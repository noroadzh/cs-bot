/**
 * PII 脱敏函数
 */
export function maskPII(value: string, kind: 'userid' | 'mobile' | 'email' | 'generic' = 'generic'): string {
  if (!value) return '';
  switch (kind) {
    case 'userid': {
      if (value.length <= 4) return value.slice(0, 1) + '***';
      return value.slice(0, 2) + '****' + value.slice(-2);
    }
    case 'mobile': {
      if (value.length !== 11) return value.replace(/.(?=.{4})/g, '*');
      return value.slice(0, 3) + '****' + value.slice(7);
    }
    case 'email': {
      const [user, domain] = value.split('@');
      if (!domain) return value;
      const masked = user.length <= 2 ? user[0] + '*' : user[0] + '***' + user[user.length - 1];
      return `${masked}@${domain}`;
    }
    case 'generic':
    default: {
      if (value.length <= 8) return '****';
      return value.slice(0, 4) + '****' + value.slice(-4);
    }
  }
}


/** 按内容模式脱敏（手机号/身份证/银行卡/邮箱），用于日志等任意文本 */
export function maskPIIPatterns(text: string): string {
  if (!text) return '';
  return text
    .replace(/\b\d{17}[\dXx]\b/g, '[身份证号]')
    .replace(/\b\d{16,19}\b/g, '[银行卡号]')
    .replace(/\b1[3-9]\d{9}\b/g, '[手机号]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[邮箱]');
}
