/**
 * Sensitive PII redactor.
 * Spec M10 §1.4.2 / import-review: 5 类正则 → 占位符替换，命中 flag 写入。
 *
 * 占位符格式: <TYPE:n> —— n 为该 type 在本 redact 调用内的第几次命中（从 1 起）
 *  - 5 类：PHONE / ID / CARD / EMAIL / URL
 *  - 关闭策略：MOCK_REDACTION=true 时全部跳过（测试用）
 *
 * 设计点：
 *  - 单次合并扫描：flags 按文本中首次出现顺序（而非正则优先级顺序）
 *  - alternation 顺序决定同一起点的优先级：URL 在 EMAIL 前（避免 URL 内 email 被截），
 *    ID 在 CARD 前（18 位身份证优先于 16-19 位通配）、PHONE 最后
 *  - 同类多次命中：占位符编号递增；sensitive_flags 每种类型只记一次
 *  - 未命中：原文返回、flags 为空
 *  - 关闭时：flags 始终为空（即使文本里看似有敏感信息）
 */
const COMBINED_RE = new RegExp(
  [
    '(?<url>https?:\\/\\/[^\\s<>"\']+)',
    '(?<email>[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})',
    '(?<id>\\b\\d{17}[\\dXx]\\b)',
    '(?<card>\\b\\d{16,19}\\b)',
    '(?<phone>(?<!\\d)1[3-9]\\d{9}(?!\\d))',
  ].join('|'),
  'g',
);

/** 命中组名 → 占位符 TYPE / flag（占位符大写导出、flags 存小写） */
const GROUP_META: Record<string, { type: string; flag: string }> = {
  phone: { type: 'PHONE', flag: 'phone' },
  id: { type: 'ID', flag: 'id' },
  card: { type: 'CARD', flag: 'card' },
  email: { type: 'EMAIL', flag: 'email' },
  url: { type: 'URL', flag: 'url' },
};

export interface RedactionResult {
  text: string;
  flags: string[];
}

export class SensitiveRedactor {
  private readonly enabled: boolean;

  constructor(opts: { mockRedaction?: boolean } = {}) {
    this.enabled = !opts.mockRedaction;
  }

  /**
   * 单次合并扫描。占位符编号规则：每个 type 在本调用内独立计数，从 1 开始。
   * flags 按 type 在文本中首次命中的顺序排列，每类只记一次。
   */
  redact(input: string): RedactionResult {
    if (!this.enabled) {
      return { text: input, flags: [] };
    }

    const counters: Record<string, number> = {};
    const flagOrder: string[] = [];
    const text = input.replace(COMBINED_RE, (match, ...rest) => {
      const groups = rest[rest.length - 1] as Record<string, string | undefined> | undefined;
      const hit = Object.keys(GROUP_META).find((g) => groups?.[g] !== undefined);
      if (!hit) return match;
      counters[hit] = (counters[hit] ?? 0) + 1;
      if (counters[hit] === 1) {
        flagOrder.push(GROUP_META[hit].flag);
      }
      return `<${GROUP_META[hit].type}:${counters[hit]}>`;
    });
    return { text, flags: flagOrder };
  }
}
