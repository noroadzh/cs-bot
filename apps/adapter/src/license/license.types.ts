/** ILicenseVerifier 接口 + LicenseState 类型 */
export interface LicenseState {
  valid: boolean;
  reason: 'valid' | 'expired' | 'revoked' | 'malformed' | 'mock' | 'native-placeholder';
  expiresAt?: string;       // ISO 8601
  daysLeft?: number;
  maxChats?: number;
  fingerprint?: string;
  mock: boolean;
}

export interface ILicenseVerifier {
  verify(): Promise<LicenseState>;
}
