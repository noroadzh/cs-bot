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
