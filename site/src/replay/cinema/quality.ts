export type Tier = 'high' | 'medium' | 'low';

export interface TierConfig {
  bloom: 'full' | 'half' | 'off';
  particles: number;
  nebula: boolean;
  dust: number;
}

export const TIERS: Record<Tier, TierConfig> = {
  high: { bloom: 'full', particles: 1, nebula: true, dust: 3 },
  medium: { bloom: 'half', particles: 0.5, nebula: true, dust: 2 },
  low: { bloom: 'off', particles: 0.25, nebula: false, dust: 1 },
};

const LOW_ABOVE_MS = 30;
const MEDIUM_ABOVE_MS = 22;

export class QualityController {
  private current: Tier;
  private readonly locked: boolean;
  private readonly windowS: number;
  private windowStart: number | null = null;
  private samples: number[] = [];
  private decided: boolean;

  constructor(opts: { start?: Tier; locked?: boolean; windowS?: number }) {
    this.current = opts.start ?? 'high';
    this.locked = opts.locked ?? false;
    this.windowS = opts.windowS ?? 2;
    this.decided = this.locked || this.current === 'low';
  }

  get tier(): Tier {
    return this.current;
  }

  sample(frameMs: number, nowS: number): Tier {
    if (this.decided) return this.current;
    if (this.windowStart === null) this.windowStart = nowS;
    this.samples.push(frameMs);
    if (nowS - this.windowStart >= this.windowS) {
      this.decided = true;
      this.current = this.stepDown(this.median());
      this.samples = [];
    }
    return this.current;
  }

  private median(): number {
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  private stepDown(medianMs: number): Tier {
    if (medianMs > LOW_ABOVE_MS) return 'low';
    if (medianMs > MEDIUM_ABOVE_MS && this.current === 'high') return 'medium';
    return this.current;
  }
}
