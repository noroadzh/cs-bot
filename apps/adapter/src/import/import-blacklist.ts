/**
 * ImportBlacklist — 入库准入黑名单（概设 §5 M10 步骤 6）
 *
 * 与 M6 出站敏感词库相互独立；命中即 auto_blocked=true，不进「建议保留」集、不可批量通过。
 */
import { readFileSync } from 'node:fs';

export class ImportBlacklist {
  private readonly terms: string[];

  constructor(terms: readonly string[] = []) {
    this.terms = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
  }

  static fromFile(path: string): ImportBlacklist {
    try {
      const terms = readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter((line) => line.length > 0);
      return new ImportBlacklist(terms);
    } catch {
      return new ImportBlacklist();
    }
  }

  get size(): number {
    return this.terms.length;
  }

  matches(text: string): boolean {
    const t = text.toLowerCase();
    return this.terms.some((term) => t.includes(term));
  }
}
