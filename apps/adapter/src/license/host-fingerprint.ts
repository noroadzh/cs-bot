/**
 * 本机机器指纹（license-native），供 internal 探针与验签同源。
 * USE_MOCK_LICENSE 不改变 fingerprint() 语义。
 */
import { createRequire } from 'node:module';

const nodeRequire: NodeRequire =
  typeof require === 'function' ? require : createRequire(process.cwd() + '/');

/** @returns 64 位 hex 指纹；native 不可用或抛错时 null */
export function getHostFingerprint(): string | null {
  try {
    const native = nodeRequire('@cs-bot/license-native') as typeof import('@cs-bot/license-native');
    const fp = native.fingerprint();
    const trimmed = String(fp ?? '').trim();
    if (!/^[a-fA-F0-9]{64}$/.test(trimmed)) return null;
    return trimmed.toLowerCase();
  } catch {
    return null;
  }
}
