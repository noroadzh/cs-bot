/**
 * ModelRouter — 模型通道选择与降级（增项 D）
 *
 * cloud：仅云；local：仅本地（失败不出站）；hybrid：本地优先，超时/故障切云。
 * 连续失败达阈值触发本地熔断（冷却期内 hybrid 直接走云、local 直接失败不出站）。
 * ChatProvider 抽象实际调用，时钟可注入，便于单测。
 */
export type ModelMode = 'cloud' | 'hybrid' | 'local';

export interface ChatProvider {
  chat(prompt: string): Promise<string>;
}

export interface RouteResult {
  text: string;
  source: 'local' | 'cloud';
  failover?: boolean;
}

export interface RouterStats {
  localSuccess: number;
  localFailures: number;
  cloudSuccess: number;
  failover: number;
  circuitOpen: boolean;
}

export interface RouterOptions {
  failThreshold: number;
  cooldownMs: number;
  now: () => number;
}

const DEFAULT_OPTS: RouterOptions = {
  failThreshold: 3,
  cooldownMs: 30_000,
  now: () => Date.now(),
};

export class ModelRouter {
  private readonly opts: RouterOptions;
  private localFailStreak = 0;
  private circuitUntil = 0;
  private readonly stats = { localSuccess: 0, localFailures: 0, cloudSuccess: 0, failover: 0 };

  constructor(
    private readonly mode: ModelMode,
    private readonly local: ChatProvider | null,
    private readonly cloud: ChatProvider,
    opts: Partial<RouterOptions> = {},
  ) {
    if ((mode === 'local' || mode === 'hybrid') && local === null) {
      throw new Error(`MODEL_MODE=${mode} requires a local provider`);
    }
    this.opts = { ...DEFAULT_OPTS, ...opts };
  }

  private circuitOpen(): boolean {
    return this.opts.now() < this.circuitUntil;
  }

  async chat(prompt: string): Promise<RouteResult> {
    if (this.mode === 'cloud') {
      const text = await this.cloud.chat(prompt);
      this.stats.cloudSuccess++;
      return { text, source: 'cloud' };
    }

    if (this.mode === 'local') {
      // 熔断期内：直接失败，绝不出站
      if (this.circuitOpen()) throw new Error('local model circuit open');
      try {
        const text = await this.local!.chat(prompt);
        this.onLocalSuccess();
        return { text, source: 'local' };
      } catch (err) {
        this.onLocalFailure();
        throw err;
      }
    }

    // hybrid：本地优先，失败切云
    if (!this.circuitOpen()) {
      try {
        const text = await this.local!.chat(prompt);
        this.onLocalSuccess();
        return { text, source: 'local' };
      } catch {
        this.onLocalFailure();
      }
    }
    const text = await this.cloud.chat(prompt);
    this.stats.cloudSuccess++;
    this.stats.failover++;
    return { text, source: 'cloud', failover: true };
  }

  getStats(): RouterStats {
    return { ...this.stats, circuitOpen: this.circuitOpen() };
  }

  getMode(): ModelMode {
    return this.mode;
  }

  private onLocalSuccess(): void {
    this.localFailStreak = 0;
    this.stats.localSuccess++;
  }

  private onLocalFailure(): void {
    this.localFailStreak++;
    this.stats.localFailures++;
    if (this.localFailStreak >= this.opts.failThreshold) {
      this.circuitUntil = this.opts.now() + this.opts.cooldownMs;
      this.localFailStreak = 0;
    }
  }
}
