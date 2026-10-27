/**
 * 关键词前缀 Trie（替代线性前缀扫描；reload 时原子替换引用）
 */
interface TrieNode {
  end: boolean;
  word?: string;
  child: Map<string, TrieNode>;
}

const newNode = (): TrieNode => ({ end: false, child: new Map() });

export class KeywordTrie {
  private readonly root: TrieNode = newNode();
  private count = 0;

  constructor(words: readonly string[] = []) {
    for (const w of words) this.insert(w);
  }

  insert(word: string): void {
    const w = word.trim();
    if (!w) return;
    let node = this.root;
    for (const ch of w) {
      let next = node.child.get(ch);
      if (!next) {
        next = newNode();
        node.child.set(ch, next);
      }
      node = next;
    }
    if (!node.end) this.count += 1;
    node.end = true;
    node.word = w;
  }

  /** 返回命中词（最长前缀）；未命中返回 '' */
  match(text: string): string {
    let node = this.root;
    let matched = '';
    for (const ch of text) {
      const next = node.child.get(ch);
      if (!next) break;
      node = next;
      if (node.end && node.word) matched = node.word;
    }
    return matched;
  }

  get size(): number {
    return this.count;
  }
}
