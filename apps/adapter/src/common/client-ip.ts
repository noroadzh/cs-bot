/**
 * 客户端 IP 解析（管理面白名单 / 访问日志共用）
 *
 * 默认取 socket 对端地址；仅当对端属于 TRUSTED_PROXY_CIDRS 时才采信
 * X-Forwarded-For / X-Real-IP，防止直连客户端伪造头部绕过白名单。
 */
import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';
import { ConfigService } from '../config/config.service.js';

type Family = 'ipv4' | 'ipv6';

interface NormalizedIp {
  address: string;
  family: Family;
}

/** 去掉端口、IPv6 方括号与 IPv4 映射前缀，返回可查询的地址 */
export function normalizeIp(raw: string | undefined | null): NormalizedIp | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 0) value = value.slice(1, end);
  }
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) value = value.split(':')[0];
  if (value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4) {
    value = value.slice(7);
  }
  const version = isIP(value);
  if (version === 4) return { address: value, family: 'ipv4' };
  if (version === 6) return { address: value, family: 'ipv6' };
  return null;
}

const cache = new Map<string, BlockList>();

/** 将逗号分隔的 CIDR 列表编译为 BlockList（按配置串缓存） */
export function buildTrustedProxies(cidrs: string | undefined | null): BlockList {
  const key = (cidrs ?? '').replace(/\s+/g, '');
  const hit = cache.get(key);
  if (hit) return hit;
  const list = new BlockList();
  for (const entry of (cidrs ?? '').split(',')) {
    const item = entry.trim();
    if (!item) continue;
    const [addr, bits] = item.split('/');
    const normalized = normalizeIp(addr);
    if (!normalized) continue;
    const prefix = bits !== undefined ? Number(bits) : normalized.family === 'ipv4' ? 32 : 128;
    if (!Number.isInteger(prefix)) continue;
    try {
      list.addSubnet(normalized.address, prefix, normalized.family);
    } catch {
      /* 非法 CIDR 跳过，避免启动期因配置笔误崩溃 */
    }
  }
  cache.set(key, list);
  return list;
}

export function isTrustedProxy(ip: string, trustedCidrs: string | undefined | null): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  return buildTrustedProxies(trustedCidrs).check(normalized.address, normalized.family);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim() || undefined;
}

/**
 * 解析有效客户端 IP。
 * - 对端不可信：忽略转发头，返回对端地址
 * - 对端可信：从 XFF 右向左跳过可信代理，取第一个非可信地址；无 XFF 时回退 X-Real-IP
 */
export function resolveClientIp(
  req: Pick<Request, 'headers'> & { ip?: string; socket?: { remoteAddress?: string } },
  trustedCidrs: string = ConfigService.instance.TRUSTED_PROXY_CIDRS,
): string {
  const peer = req.socket?.remoteAddress ?? req.ip ?? '';
  const normalizedPeer = normalizeIp(peer);
  if (!normalizedPeer) return peer;
  const peerAddress = normalizedPeer.address;
  if (!isTrustedProxy(peerAddress, trustedCidrs)) return peerAddress;

  const forwarded = req.headers['x-forwarded-for'];
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '')
    .split(',')
    .map((s) => normalizeIp(s)?.address)
    .filter((s): s is string => Boolean(s));
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!isTrustedProxy(chain[i], trustedCidrs)) return chain[i];
  }
  if (chain.length > 0) return chain[0];

  const realIp = normalizeIp(headerValue(req.headers['x-real-ip']));
  return realIp?.address ?? peerAddress;
}
