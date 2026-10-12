/** SensitiveFilterService */
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { watch, readFileSync, existsSync } from 'fs';
import AhoCorasick from 'ahocorasick';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

interface AhoInstance {
  search(text: string): Array<[number, string[]]>;
}

@Injectable()
export class SensitiveFilterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('SensitiveFilterService');
  private automaton: AhoInstance | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private readonly file: string;

  constructor(_config: ConfigService) {
    this.file = ConfigService.instance.SENSITIVE_WORDS_FILE;
  }

  onModuleInit() {
    this.load();
    this.startWatcher();
  }

  onModuleDestroy() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = readFileSync(this.file, 'utf8');
      const words = raw.replace(/^\uFEFF/, '').split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
      if (words.length === 0) return;
      this.automaton = new AhoCorasick(words) as unknown as AhoInstance;
      this.logger.log({ detail: 'loaded', count: words.length });
    } catch (err) {
      this.logger.warn({ detail: 'load-error', err: (err as Error).message });
    }
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(this.file, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.load(), 500);
      });
    } catch { /* ignore */ }
  }

  sweep(text: string): string {
    if (!this.automaton || !text) return text;
    const hits = this.automaton.search(text);
    if (hits.length === 0) return text;
    const hitWords = [...new Set(hits.flatMap(([, matched]) => matched).filter(Boolean))];
    this.logger.warn({ detail: 'filter-hit', count: hitWords.length });
    let result = text;
    for (const word of hitWords) {
      result = result.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[内容已过滤]');
    }
    return result;
  }
}
