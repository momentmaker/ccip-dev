import type { Env } from './env';

/** KTD20: `dry` reads and stores but publishes nothing; any value other than `dry` or `on` is off. */
export type PassportMode = 'off' | 'dry' | 'on';
/** Gates Telegram posts only; any value other than `drafts` or `on` is off. */
export type PassportPublic = 'off' | 'drafts' | 'on';

export interface PassportConfig {
  mode: PassportMode;
  publicPosts: PassportPublic;
}

export function passportConfig(env: Pick<Env, 'PASSPORT' | 'PASSPORT_PUBLIC'>): PassportConfig {
  const mode: PassportMode = env.PASSPORT === 'dry' || env.PASSPORT === 'on' ? env.PASSPORT : 'off';
  const publicPosts: PassportPublic = env.PASSPORT_PUBLIC === 'drafts' || env.PASSPORT_PUBLIC === 'on' ? env.PASSPORT_PUBLIC : 'off';
  return { mode, publicPosts };
}

/** A post record is sendable only when the record is live and the wire is not off; otherwise it is seeded and never sent. */
export function postState(config: PassportConfig): 'due' | 'seeded' {
  return config.mode === 'on' && config.publicPosts !== 'off' ? 'due' : 'seeded';
}
