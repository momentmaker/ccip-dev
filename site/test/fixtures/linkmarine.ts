import type { DossierCard, MarineCard, MarineWebCard, RecordsCard, SitrepCard, Tier, VaultCard } from '@ccip-dev/core/linkmarine';

/** Text the card fonts can draw: their Latin subset. */
export const DRAWABLE_TEXT = /^[\u0020-\u007e\u00a0-\u00ff\u2000-\u206f\u20ac\u2122]*$/;

/** Four Marines from docs/callsigns/rules.md's samples, one per tier, at their snapshot odds; between them they use all three planet layouts. */
export const MARINES: Readonly<Record<Tier, { serial: number; callsign: string; counts: readonly number[]; percentile: number; blood: string; faith: string; name: string }>> = {
  legendary: { serial: 7, callsign: 'painting-space-prophecy', counts: [1, 1, 3], percentile: 97.9, blood: 'LINK+', faith: '4IR', name: 'momentmaker' },
  rare: { serial: 42, callsign: 'yes-glowy-millionaire', counts: [5, 1, 1], percentile: 95.3, blood: 'O-LINK', faith: 'SERGEY', name: 'sergey_nakamoto' },
  uncommon: { serial: 108, callsign: 'party-4ir-deep', counts: [2, 47, 1], percentile: 76.7, blood: '7777777', faith: 'STAKING', name: 'Chad Marine of the 4th Industrial Revolution' },
  common: { serial: 1203, callsign: 'clown-rory-pepe', counts: [6, 15, 426], percentile: 17.3, blood: 'LINK+', faith: 'FUNDAMENTALS', name: 'rory' },
};

/** The mockup's memes in the chainlinkmeme archive: painting, space and prophecy. */
export const MOCKUP_MEMES = ['a3ccf753ffd27a408d0d5d974faecf2f.jpeg', 'e572d111223722c3d6cce9d52b90f45e.jpeg', 'aabd55f53e8aea9de4665be183d5bb7d.jpeg'];

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

// Real intel from data.ccip.dev on Tue 13 Oct 2026, as the bot computes it: the cards' fixtures and the visual check's input.
export const AVALANCHE = { selector: '6433500567565415381', name: 'Avalanche' };
export const BASE = { selector: '15971525489660198786', name: 'Base' };
export const ETHEREUM = { selector: '5009297550715157269', name: 'Ethereum' };
export const MONAD = { selector: '8481857512324358265', name: 'Monad' };
export const PLASMA = { selector: '9335212494177455608', name: 'Plasma' };
export const ROBINHOOD = { selector: '6180753054346818345', name: 'Robinhood' };

export const SITREP: SitrepCard = {
  updatedAt: '2026-10-13T11:28:01.860Z',
  messages: 685,
  pace: { projected: 1433.6563323454902, yesterday: 1625 },
  usd: 44064348.04,
  feesUsd: 419.36,
  linkSharePct: 0.25,
  senders: 211,
  medianDeliveryS: 820,
  lanes: [
    { src: MONAD, dst: ETHEREUM, usd: 16298903.16 },
    { src: ETHEREUM, dst: MONAD, usd: 10704140.65 },
    { src: ETHEREUM, dst: PLASMA, usd: 6754321.91 },
    { src: MONAD, dst: AVALANCHE, usd: 1999585.26 },
    { src: MONAD, dst: PLASMA, usd: 1468701.01 },
  ],
};

export const DOSSIER: DossierCard = {
  asOf: '2026-10-13T06:01:00.177Z',
  chain: BASE,
  rank: 3,
  ranked: 92,
  feeRank: 1,
  messages: 552062,
  usd: 3792810516,
  feesUsd: 356718.47,
  week: { messages: 3881, usd: 16181949 },
  days: [{ day: '2026-10-06', messages: 684 }, { day: '2026-10-07', messages: 639 }, { day: '2026-10-08', messages: 756 }, { day: '2026-10-09', messages: 391 }, { day: '2026-10-10', messages: 352 }, { day: '2026-10-11', messages: 442 }, { day: '2026-10-12', messages: 617 }],
  partners: [{ chain: MONAD, usd: 5788934 }, { chain: ETHEREUM, usd: 5290358 }, { chain: AVALANCHE, usd: 2114221 }, { chain: ROBINHOOD, usd: 1454504 }],
  since: '2023-09-16',
};

export const VAULT: VaultCard = {
  asOf: '2026-10-13T11:00:55.843Z',
  link: 6204681.79,
  valueUsd: 79818684,
  priceUsd: 12.8643,
  changePct: 15.66,
  costUsd: 69008608.43,
  streak: 62,
  avgWeeklyLink: 85687.03,
  lastDeposit: { link: 82480.36, day: '2026-10-08' },
  nextDue: '2026-10-15',
  overdue: false,
  weekly: [121949.84, 123521.9, 125525.28, 119241.2, 100908.77, 123777.33, 132002.93, 148258.62, 147197.58, 143676.39, 153956.18, 151674.71, 146110.67, 138306.29, 135168.33, 135549.02, 139956.08, 127744.15, 103041.41, 91988.7, 97110.77, 91115.63, 97459.26, 88105.46, 74703.04, 82480.36],
  milestone: { link: 7000000, eta: '2026-12-17' },
};

export const RECORDS: RecordsCard = {
  asOf: '2026-10-13T06:01:00.177Z',
  medals: [
    { kind: 'messages', value: 47414, day: '2026-02-22', lane: null },
    { kind: 'value', value: 330226186.84, day: '2026-04-20', lane: null },
    { kind: 'fees', value: 57347.81, day: '2026-07-09', lane: null },
    { kind: 'largest_fee', value: 9002.29, day: '2025-08-19', lane: { src: 'WEMIX', dst: 'Ethereum' } },
    { kind: 'link_share', value: 100, day: '2023-07-08', lane: null },
  ],
  newest: 'fees',
  messages: 1578970,
  usd: 24320486693.239994,
  since: '2023-07-06',
};

/** A tier's sample Marine as the roster's web card draws it: no name, no avatar. */
export function webMarine(tier: Tier, pngs: readonly Uint8Array[]): MarineWebCard {
  const m = marine(tier, pngs);
  return { serial: m.serial, callsign: m.callsign, tier: m.tier, percentile: m.percentile, memes: m.memes, blood: m.blood, faith: m.faith, enlistedAt: m.enlistedAt };
}
