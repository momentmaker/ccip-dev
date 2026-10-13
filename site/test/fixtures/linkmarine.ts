import type { MarineCard, Tier } from '@ccip-dev/core/linkmarine';

/** Text the card fonts can draw: their Latin subset. */
export const DRAWABLE_TEXT = /^[\u0020-\u007e\u00a0-\u00ff\u2000-\u206f\u20ac\u2122]*$/;

/** Four Marines from docs/callsigns/rules.md's samples, one per tier, at their snapshot odds; between them they use all three planet layouts. */
export const MARINES: Readonly<Record<Tier, { serial: number; callsign: string; counts: readonly number[]; percentile: number; blood: string; faith: string; name: string }>> = {
  legendary: { serial: 7, callsign: 'painting-space-prophecy', counts: [1, 1, 3], percentile: 97.9, blood: 'LINK+', faith: '4IR', name: 'momentmaker' },
  rare: { serial: 42, callsign: 'yes-glowy-millionaire', counts: [5, 1, 1], percentile: 95.3, blood: 'O-LINK', faith: 'SERGEY', name: 'sergey_nakamoto' },
  uncommon: { serial: 108, callsign: 'party-4ir-deep', counts: [2, 47, 1], percentile: 76.7, blood: '7777777', faith: 'STAKING', name: 'Chad Marine of the 4th Industrial Revolution' },
  common: { serial: 1203, callsign: 'clown-rory-pepe', counts: [6, 15, 426], percentile: 17.3, blood: 'LINK+', faith: 'FUNDAMENTALS', name: 'rory' },
};

/** A tier's sample Marine as the site draws it, with the memes given (reused when fewer than three). */
export function marine(tier: Tier, pngs: readonly Uint8Array[], avatar: Uint8Array | null = null): MarineCard {
  const m = MARINES[tier];
  return {
    serial: m.serial,
    callsign: m.callsign,
    tier,
    percentile: m.percentile,
    memes: m.callsign.split('-').map((tag, i) => ({ tag, count: m.counts[i]!, png: pngs[i % pngs.length]! })),
    blood: m.blood,
    faith: m.faith,
    name: m.name,
    enlistedAt: '2026-10-13T10:40:00.000Z',
    avatar,
  };
}
