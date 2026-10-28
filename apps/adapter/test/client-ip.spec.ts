import { describe, it, expect } from '@jest/globals';
import { resolveClientIp, normalizeIp, isTrustedProxy } from '../src/common/client-ip.js';

const req = (peer: string | undefined, headers: Record<string, string> = {}): any => ({
  socket: peer ? { remoteAddress: peer } : undefined,
  ip: peer,
  headers,
});

const TRUST = '172.30.0.0/24,127.0.0.1/32,::1/128';

describe('client-ip', () => {
  it('normalizes mapped IPv4 and ports', () => {
    expect(normalizeIp('::ffff:10.0.0.5')?.address).toBe('10.0.0.5');
    expect(normalizeIp('10.0.0.5:443')?.address).toBe('10.0.0.5');
    expect(normalizeIp('[::1]')?.address).toBe('::1');
    expect(normalizeIp('not-an-ip')).toBeNull();
  });

  it('trusts only configured CIDRs', () => {
    expect(isTrustedProxy('172.30.0.9', TRUST)).toBe(true);
    expect(isTrustedProxy('172.31.0.9', TRUST)).toBe(false);
  });

  it('ignores forwarded headers from an untrusted peer', () => {
    const out = resolveClientIp(req('203.0.113.7', { 'x-forwarded-for': '127.0.0.1' }), TRUST);
    expect(out).toBe('203.0.113.7');
  });

  it('uses the rightmost untrusted address from a trusted proxy chain', () => {
    const out = resolveClientIp(
      req('172.30.0.2', { 'x-forwarded-for': '198.51.100.9, 203.0.113.4, 172.30.0.3' }),
      TRUST,
    );
    expect(out).toBe('203.0.113.4');
  });

  it('ignores a spoofed leftmost entry', () => {
    const out = resolveClientIp(
      req('172.30.0.2', { 'x-forwarded-for': '127.0.0.1, 198.51.100.9' }),
      TRUST,
    );
    expect(out).toBe('198.51.100.9');
  });

  it('falls back to X-Real-IP when no XFF is present', () => {
    const out = resolveClientIp(req('172.30.0.2', { 'x-real-ip': '198.51.100.20' }), TRUST);
    expect(out).toBe('198.51.100.20');
  });

  it('returns the peer when every hop is trusted', () => {
    const out = resolveClientIp(req('172.30.0.2', { 'x-forwarded-for': '172.30.0.5' }), TRUST);
    expect(out).toBe('172.30.0.5');
  });

  it('supports loopback IPv6 peers', () => {
    const out = resolveClientIp(req('::1', { 'x-forwarded-for': '198.51.100.30' }), TRUST);
    expect(out).toBe('198.51.100.30');
  });
});
