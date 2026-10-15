import type { RecordKind } from './records';

/** The LinkMarine Discord bot's shared vocabulary: the bot draws callsigns and computes intel, the site Worker draws the cards. */

export const TIERS = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Tier = (typeof TIERS)[number];

/** Each tier's share of all draws, in percent (docs/callsigns/rules.md). */
export const TIER_SHARE_PCT: Readonly<Record<Tier, number>> = { common: 60, uncommon: 25, rare: 12, legendary: 3 };

/** The share of draws at this tier or rarer, which a card prints as "top X%"; null for Common, where it would say "top 100%". */
export function tierTopPct(tier: Tier): number | null {
  if (tier === 'common') return null;
  return TIERS.slice(TIERS.indexOf(tier)).reduce((sum, t) => sum + TIER_SHARE_PCT[t], 0);
}

/** "rarer than N in 100": the share of simulated draws below this one, floored, and never 100. */
export function rarerThan(percentile: number): number {
  return Math.min(99, Math.floor(percentile));
}

/**
 * The card's odds line: "top 15% · rarer than 95 in 100 Marines". The share is left out for Common (it would say
 * "top 100%") and "rarer than" where N would be 0. Null when both are left out.
 */
export function marineOdds(tier: Tier, percentile: number): string | null {
  const top = tierTopPct(tier);
  const n = rarerThan(percentile);
  const parts = [top === null ? null : `top ${top}%`, n > 0 ? `rarer than ${n} in 100 Marines` : null].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Rare and Legendary cards also get the animated glint. */
export function hasGlint(tier: Tier): boolean {
  return tier === 'rare' || tier === 'legendary';
}

/** Filled pips (◆) of three for a tag carried by `memes` SFW memes: ◆◆◆ for 1, ◆◆◇ for 2–9, ◆◇◇ for 10–49, ◇◇◇ for 50 or more. */
export function filledPips(memes: number): 0 | 1 | 2 | 3 {
  if (memes <= 1) return 3;
  if (memes <= 9) return 2;
  if (memes <= 49) return 1;
  return 0;
}

/** FNV-1a (32-bit) of the callsign: the seed of everything drawn from it, from the memes to the stars. */
export function callsignSeed(callsign: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(callsign)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** mulberry32: a small seeded generator in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RIM_PHRASES = ['LINK MARINES', 'STAY POOR', '4IR', 'FUNDAMENTALLY', 'WAGMI'] as const;

/**
 * The rim microtext: every phrase once, in an order the seed shuffles, then again, so it runs past the tag's edge.
 * With maxChars it is cut to whole phrases (repeating the order as needed) no longer than maxChars.
 */
export function rimText(seed: number, maxChars?: number): string {
  const random = seededRandom(seed);
  const order: string[] = [...RIM_PHRASES];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  if (maxChars === undefined) return [...order, ...order].join(' · ');
  const phrases: string[] = [];
  for (let i = 0; ; i++) {
    const next = [...phrases, order[i % order.length]!].join(' · ');
    if (next.length > maxChars) break;
    phrases.push(order[i % order.length]!);
  }
  return phrases.join(' · ');
}

/** "0007": four digits until the 10,000th Marine. */
export function serialText(serial: number): string {
  return String(serial).padStart(4, '0');
}

export interface MarineCardMeme {
  tag: string;
  /** SFW memes carrying the tag in the snapshot: the pips and "N memes". */
  count: number;
  /** The meme as the bot keeps it in R2: the PNG that prepareMeme made. */
  png: Uint8Array;
}

export interface MarineCard {
  serial: number;
  callsign: string;
  tier: Tier;
  /** The share of simulated draws scoring below this one, 0–100. */
  percentile: number;
  /** The three tags' memes, in draw order. */
  memes: readonly MarineCardMeme[];
  blood: string;
  faith: string;
  /** The Discord display name stamped at enlistment. */
  name: string;
  enlistedAt: string;
  /** The Discord avatar as PNG bytes, or null for the gradient disc. */
  avatar: Uint8Array | null;
}

/** The card as the public roster draws it: everything but the stamped Discord name and avatar. */
export type MarineWebCard = Omit<MarineCard, 'name' | 'avatar'>;

export interface IntelChain {
  selector: string;
  name: string;
}

export interface IntelLane {
  src: IntelChain;
  dst: IntelChain;
  usd: number;
}

export interface SitrepCard {
  updatedAt: string;
  messages: number;
  /** null before 01:00 UTC; `yesterday` is null when history.json's last day is not yesterday. */
  pace: { projected: number; yesterday: number | null } | null;
  usd: number;
  feesUsd: number | null;
  linkSharePct: number | null;
  senders: number;
  medianDeliveryS: number | null;
  /** Up to five of today's lanes, by value. */
  lanes: readonly IntelLane[];
}

export interface DossierCard {
  asOf: string;
  chain: IntelChain;
  /** By all-time value moved, both directions, among every chain in replay.json. */
  rank: number;
  ranked: number;
  /** 1–3 when the chain is in the top 3 by fees over the last 7 days. */
  feeRank: number | null;
  messages: number;
  usd: number;
  feesUsd: number | null;
  week: { messages: number; usd: number };
  /** The last 7 finalized days, oldest first. */
  days: readonly { day: string; messages: number }[];
  /** Up to four partners over the last 7 days, by value. */
  partners: readonly { chain: IntelChain; usd: number }[];
  since: string | null;
}

export interface VaultCard {
  asOf: string;
  link: number;
  valueUsd: number | null;
  priceUsd: number | null;
  changePct: number | null;
  costUsd: number | null;
  streak: number;
  avgWeeklyLink: number | null;
  lastDeposit: { link: number; day: string } | null;
  nextDue: string | null;
  overdue: boolean;
  /** LINK deposited each week, the last 26 weeks, oldest first. */
  weekly: readonly number[];
  milestone: { link: number; eta: string } | null;
}

export interface RecordMedal {
  kind: RecordKind;
  value: number;
  day: string;
  /** The largest single fee's lane, by name. */
  lane: { src: string; dst: string } | null;
}

export interface RecordsCard {
  asOf: string;
  medals: readonly RecordMedal[];
  /** The record set most recently, which the card raises. */
  newest: RecordKind | null;
  messages: number;
  usd: number;
  since: string | null;
}

export interface IntelCards {
  sitrep: SitrepCard;
  dossier: DossierCard;
  vault: VaultCard;
  records: RecordsCard;
}

export type IntelKind = keyof IntelCards;
export const INTEL_KINDS: readonly IntelKind[] = ['sitrep', 'dossier', 'vault', 'records'];

/** A dog tag card's two images from one render. */
export interface MarineCardImages {
  png: Uint8Array;
  /** The glint for Rare and Legendary; null for the others, and when the glint failed. */
  gif: Uint8Array | null;
  /** Why the glint failed, when it did: the PNG is still good to post. */
  glintError: string | null;
}

/** The site Worker's LinkMarine entrypoint, as the bot sees it over its service binding. */
export interface LinkMarineRenderer {
  /** A meme as a 240×240 PNG, cover-cropped: the card never draws one larger. */
  prepareMeme(image: Uint8Array): Promise<Uint8Array>;
  renderMarineCard(card: MarineCard): Promise<Uint8Array>;
  /** The animated GIF for Rare and Legendary cards; null for the others. */
  renderMarineGlint(card: MarineCard): Promise<Uint8Array | null>;
  /** The card and its glint from one render, so a Rare or Legendary costs one Satori and resvg pass, not two. */
  renderMarineCards(card: MarineCard): Promise<MarineCardImages>;
  /** The roster's card for the web: the dog tag card without the name and avatar row. */
  renderMarineWebCard(card: MarineWebCard): Promise<Uint8Array>;
  /** The Telegram sticker: the two tags on their chain with the serial, 512×512 on a transparent ground, no name or avatar. */
  renderMarineSticker(card: MarineWebCard): Promise<Uint8Array>;
  /** The 1080×1920 Story card: the tags large, the serial, callsign and tier, the three memes. No name or avatar. */
  renderMarineStory(card: MarineWebCard): Promise<Uint8Array>;
  renderIntelCard<K extends IntelKind>(kind: K, card: IntelCards[K]): Promise<Uint8Array>;
}

/** LinkMarines on Telegram: the bot, its Mini App and the sticker packs, as the bot and the site both name them. */
export const TELEGRAM_BOT_USERNAME = 'ccipdevbot';
/** The Mini App's direct link: registered with @BotFather as `marines`. */
export const MINI_APP_LINK = `https://t.me/${TELEGRAM_BOT_USERNAME}/marines`;
export const MINI_APP_URL = 'https://ccip.dev/tg/';

/** Telegram accepts a `startapp` of 1–64 letters, digits, underscores and hyphens; anything else is left off, so no other query can ride on the link. */
const STARTAPP_VALUE = /^[A-Za-z0-9_-]{1,64}$/;
export const miniAppLink = (startapp?: string) => (startapp && STARTAPP_VALUE.test(startapp) ? `${MINI_APP_LINK}?startapp=${startapp}` : MINI_APP_LINK);

/** Telegram caps a static sticker set at 120 stickers. */
export const STICKERS_PER_PACK = 120;
/** A Marine's sticker volume: serials 1–120 are Vol. 1, 121–240 Vol. 2, and so on. */
export const stickerVolume = (serial: number) => Math.ceil(serial / STICKERS_PER_PACK);
export const stickerPackName = (volume: number) => `linkmarines${volume === 1 ? '' : volume}_by_${TELEGRAM_BOT_USERNAME}`;
export const stickerPackTitle = (volume: number) => `LinkMarines Vol. ${volume} · ccip.dev`;
export const stickerPackUrl = (volume: number) => `https://t.me/addstickers/${stickerPackName(volume)}`;

/** Where a Mini App link opens: screen 1, a Marine on the roster, or a tag's sheet on the roster. */
export type StartParam = { kind: 'enlist' } | { kind: 'marine'; serial: number } | { kind: 'tag'; tag: string };

const START_MARINE = /^marine_([1-9]\d{0,8})$/;
const START_TAG = /^tag_([a-z0-9]{1,13})$/;

/** A `startapp` value as the Mini App reads it; anything else is null, so a link can only ever open a known screen. */
export function parseStartParam(param: string | null | undefined): StartParam | null {
  if (param === 'enlist') return { kind: 'enlist' };
  const marine = START_MARINE.exec(param ?? '');
  if (marine) return { kind: 'marine', serial: Number(marine[1]) };
  const tag = START_TAG.exec(param ?? '');
  return tag ? { kind: 'tag', tag: tag[1]! } : null;
}

/** What the Mini App is told of a Marine: never the name, the photo or the account. */
export interface MarineSummary {
  serial: number;
  callsign: string;
  tags: string[];
  tier: Tier;
  percentile: number;
  memes: { tag: string; file: string; count: number }[];
  /** The sticker pack volume the Marine's sticker is in, or will be. */
  volume: number;
  cardReady: boolean;
}

/** ok: a member of a gate chat, or already enlisted. join: not yet in one. */
export type Gate = 'ok' | 'join';

/** POST /tg/session. */
export type SessionAnswer = { switch: 'off' } | { switch: 'on'; marine: MarineSummary | null; gate: Gate };
/** POST /tg/enlist, when it enlists or finds the Marine. */
export interface EnlistAnswer {
  already: boolean;
  marine: MarineSummary;
  banner: 'rare' | 'legendary' | null;
}
