/**
 * 第三方包本地声明（无 @types 时使用）
 */
declare module 'ahocorasick' {
  interface AhoCorasickMatch { keyword: string; start: number; end: number; }
  interface AhoCorasick {
    findAll(text: string): AhoCorasickMatch[];
  }
  export default class AhoCorasick {
    constructor(keywords: string[]);
    findAll(text: string): AhoCorasickMatch[];
  }
}
