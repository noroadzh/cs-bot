/**
 * ExportPackager — 租户数据导出包（概设 §5 M11 注销导出）
 *
 * 把 KB/素材/配置序列化后用租户密钥库加密为可交付的加密包；read 用于校验。
 * 真实实现可在此基础上打 tar；本类聚焦「加密打包 + 可解」的可单测逻辑。
 */
import type { TenantSecretStore } from './tenant-secret-store.js';

export interface ExportInput {
  tenantId: string;
  knowledgeBase: string;
  assets: string[];
  config: string;
}

export class ExportPackager {
  constructor(private readonly store: TenantSecretStore) {}

  build(input: ExportInput): Buffer {
    return Buffer.from(this.store.encrypt(JSON.stringify(input)), 'utf8');
  }

  read(encrypted: Buffer): ExportInput {
    return JSON.parse(this.store.decrypt(encrypted.toString('utf8'))) as ExportInput;
  }
}
