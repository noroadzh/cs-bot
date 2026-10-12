/**
 * PII mask utilities
 */
export function maskPII(value: string, _type: string = 'default'): string {
  if (!value || value.length < 4) return '***';
  return value.slice(0, 2) + '***' + value.slice(-2);
}

export function logRedact(obj: Record<string, unknown>): Record<string, unknown> {
  const secretKeys = ['password', 'secret', 'token', 'apiKey', 'apikey', 'key', 'pwd'];
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      secretKeys.some((s) => k.toLowerCase().includes(s)) ? [k, '***'] : [k, v],
    ),
  );
}
