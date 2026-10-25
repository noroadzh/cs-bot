/**
 * TenantSecretStore — 租户密钥加密存储（概设 §5 M11 密钥层）
 *
 * AES-256-GCM；主密钥经 scrypt 派生。密文格式 iv:tag:ciphertext（base64）。
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export class TenantSecretStore {
  private readonly key: Buffer;

  constructor(masterKey: string) {
    if (!masterKey || masterKey.length < 8) {
      throw new Error('master key too short');
    }
    this.key = scryptSync(masterKey, 'csbot-tenant-secret', 32);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) throw new Error('invalid ciphertext');
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
