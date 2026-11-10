/**
 * Jest stub for @cs-bot/license-native when prebuilds/*.node is absent.
 * Default fingerprint() → null mimics “native 未加载”，避免误伤 MockLicenseVerifier 绑定校验。
 * 个别 spec 可用 jest.mock 覆盖。
 */
module.exports = {
  fingerprint: () => null,
  selfcheck: () => ({ clean: true, evidence: [] }),
  verify: () => ({
    valid: true,
    reason: 'valid',
    fingerprint: '',
    expiresAtMs: Date.now() + 86400000,
    daysLeft: 1,
    maxChats: 10,
  }),
  antireplay: () => ({ ok: true }),
};
