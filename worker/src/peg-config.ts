import { DEFAULT_PEG_THRESHOLDS, type PegThresholds } from '@ccip-dev/core';
import type { Env } from './env';

export const PEG_ATTRIBUTION = 'Data: Curve (prices.curve.finance), Ethereum mainnet, stake.link contracts';

export interface PegConfig {
  thresholds: PegThresholds;
  publicPosts: boolean;
}

const fraction = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) && n > 0 && n < 50 ? n / 100 : null;
};

/** A threshold that cannot be read falls back with both defaults: comparing against NaN would never alert. */
export function pegConfig(env: Pick<Env, 'PEG_ALERT_PRIVATE_PCT' | 'PEG_ALERT_PUBLIC_PCT' | 'PEG_PUBLIC'>): PegConfig {
  const privateLine = fraction(env.PEG_ALERT_PRIVATE_PCT) ?? (env.PEG_ALERT_PRIVATE_PCT === undefined ? DEFAULT_PEG_THRESHOLDS.private : null);
  const publicLine = fraction(env.PEG_ALERT_PUBLIC_PCT) ?? (env.PEG_ALERT_PUBLIC_PCT === undefined ? DEFAULT_PEG_THRESHOLDS.public : null);
  const usable = privateLine !== null && publicLine !== null && privateLine < publicLine;
  if (!usable) {
    console.warn(`[peg] thresholds PEG_ALERT_PRIVATE_PCT=${env.PEG_ALERT_PRIVATE_PCT} PEG_ALERT_PUBLIC_PCT=${env.PEG_ALERT_PUBLIC_PCT} are unusable; using 0.3% and 0.75%`);
  }
  return { thresholds: usable ? { private: privateLine, public: publicLine } : DEFAULT_PEG_THRESHOLDS, publicPosts: env.PEG_PUBLIC === 'on' };
}
