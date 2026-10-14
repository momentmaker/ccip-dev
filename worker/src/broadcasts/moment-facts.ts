import { addDays, dayOf, parseSenderKey, senderKeyAddress } from '@ccip-dev/core';
import type { MomentTarget } from '@ccip-dev/core/broadcasts';
import { moversOf, roundupOf, type BoardName, type Climber, type Countdown, type MomentsBody } from '@ccip-dev/core/moments';
import { shortAddress } from '@ccip-dev/core/names';
import type { BoardEntry, Poll, SenderArrival, Spotlight } from '@ccip-dev/core/public';
import type { RunContext } from '../context';
import { buildMoments } from '../moments';
import { historyDays } from '../publish';
import { createTagger, type Player, type Tagger } from './tags';

export interface WelcomeFacts {
  kind: 'welcome';
  selector: string;
  chain: Player;
  number: number;
  day: string;
  messages: number;
  usd: number;
  /** By first-day value. */
  partners: Player[];
}

export interface NewcomerFacts {
  kind: 'newcomer';
  key: string;
  /** The post's subject: tagged by its handle only as a verified project, never through a spread label. */
  sender: Player;
  /** The project's page, or null for an address. */
  slug: string | null;
  day: string;
  firstDay: string;
  rank: number;
  /** Its messages on `day`. */
  messages: number;
  /** Its messages from its first day through `day`. */
  total: number;
  chains: Player[];
}

export interface CountdownFacts {
  kind: 'countdown';
  countdown: Countdown;
}

export type MoverName = { kind: 'chain'; player: Player } | { kind: 'token'; symbol: string } | { kind: 'lane'; src: Player; dst: Player };

export interface Mover {
  board: BoardName;
  name: MoverName;
  rank: number;
  /** Places gained; null for an entry from outside the top 10. */
  gain: number | null;
  /** Fees for the fee board, value moved for the others. */
  value: number;
}

export interface MoversFacts {
  kind: 'movers';
  monday: string;
  /** The new #1 when there is one, otherwise the top climber. */
  headline: Mover;
  newLeader: boolean;
  /** The #1 the week before, for a new #1. */
  dethroned: MoverName | null;
  climbers: Mover[];
}

export interface SpotlightFacts {
  kind: 'spotlight';
  monday: string;
  chain: Player;
  spotlight: Spotlight;
  partners: Player[];
  token: { symbol: string; usd: number } | null;
}

export interface RoundupFacts {
  kind: 'roundup';
  monday: string;
  /** Every new lane and token of the week, by first-day value; the copy decides how many to name. */
  lanes: { key: string; src: Player; dst: Player; usd: number }[];
  tokens: { key: string; symbol: string; chain: Player; project: Player | null }[];
  network: MomentsBody['network'];
  /** Posted after its week's Sunday, as when carried into the next week, so its copy says "last week". */
  lastWeek: boolean;
}

export interface PollFacts {
  kind: 'poll';
  monday: string;
  poll: Poll;
  /** Last week's poll, when one was sent. */
  last: Poll | null;
}

export type MomentFacts = WelcomeFacts | NewcomerFacts | CountdownFacts | MoversFacts | SpotlightFacts | RoundupFacts | PollFacts;

const MOMENT_FACT_KINDS: ReadonlySet<string> = new Set<MomentFacts['kind']>(['welcome', 'newcomer', 'countdown', 'movers', 'spotlight', 'roundup', 'poll']);

export function isMomentFacts(facts: { kind: string }): facts is MomentFacts {
  return MOMENT_FACT_KINDS.has(facts.kind);
}

export interface MomentsSource {
  moments: MomentsBody;
  tags: Tagger;
  /** The day the moments post. */
  today: string;
}

/** The moments as of yesterday, read from D1 through the builder that writes moments.json, so a caption and its card agree. */
export async function loadMomentsSource(c: RunContext): Promise<MomentsSource> {
  const today = dayOf(c.deps.now());
  const moments = await buildMoments(c, { lastDay: addDays(today, -1), days: await historyDays(c) });
  const tokenKeys = moments.arrivals.tokens.filter((t) => t.key.includes(':')).map((t) => t.key);
  return { moments, tags: await createTagger(c, tokenKeys), today };
}

const addressOf = (key: string) => key.slice(key.indexOf(':') + 1);

function moverName(tags: Tagger, board: BoardName, entry: BoardEntry): MoverName {
  if (board === 'fee_chains') return { kind: 'chain', player: tags.chain(entry.key) };
  if (board === 'tokens') return { kind: 'token', symbol: entry.label ?? shortAddress(addressOf(entry.key)) };
  const [src = '', dst = ''] = entry.key.split('>');
  return { kind: 'lane', src: tags.chain(src), dst: tags.chain(dst) };
}

const mover = (tags: Tagger, c: Climber): Mover => ({ board: c.board, name: moverName(tags, c.board, c.entry), rank: c.entry.rank, gain: c.gain, value: c.entry.value });

function moversFacts(src: MomentsSource, monday: string): MoversFacts | null {
  const movers = moversOf(src.moments.weeks, monday);
  if (movers === null) return null;
  const climbers = movers.climbers.map((c) => mover(src.tags, c));
  const h = movers.headline;
  if (h.kind === 'climber') return { kind: 'movers', monday, headline: mover(src.tags, h.climber), newLeader: false, dethroned: null, climbers };
  return {
    kind: 'movers',
    monday,
    headline: mover(src.tags, { board: h.board, entry: h.entry, gain: h.entry.previous_rank === null ? null : h.entry.previous_rank - 1 }),
    newLeader: true,
    dethroned: h.dethroned ? moverName(src.tags, h.board, h.dethroned) : null,
    climbers,
  };
}

function roundupFacts(src: MomentsSource, monday: string): RoundupFacts | null {
  const roundup = roundupOf(src.moments, monday);
  if (roundup === null) return null;
  const { tags } = src;
  return {
    kind: 'roundup',
    monday,
    lanes: roundup.lanes.map((l) => {
      const [a = '', b = ''] = l.key.split('>');
      return { key: l.key, src: tags.chain(a), dst: tags.chain(b), usd: l.usd };
    }),
    tokens: roundup.tokens.map((t) => ({
      key: t.key,
      symbol: t.symbol ?? shortAddress(addressOf(t.key)),
      chain: tags.chain(t.chains[0] ?? ''),
      project: t.key.includes(':') ? tags.tokenProject(t.key) : tags.groupProject(t.key),
    })),
    network: src.moments.network,
    lastWeek: src.today > addDays(monday, 6),
  };
}

function newcomerFacts(tags: Tagger, a: SenderArrival): NewcomerFacts {
  const parsed = parseSenderKey(a.key);
  return {
    kind: 'newcomer',
    key: a.key,
    sender: { name: a.label ?? shortAddress(senderKeyAddress(a.key)), x: a.inferred ? null : a.x },
    slug: parsed.kind === 'project' ? parsed.slug : null,
    day: a.day,
    firstDay: a.first_day,
    rank: a.rank,
    messages: a.messages,
    total: a.total_messages,
    chains: a.chains.map((s) => tags.chain(s)),
  };
}

/** The facts of one moment, or null when the data does not hold it. */
export function momentFacts(src: MomentsSource, target: MomentTarget): MomentFacts | null {
  const { moments, tags } = src;
  switch (target.kind) {
    case 'welcome': {
      const a = moments.arrivals.chains.find((c) => c.selector === target.selector);
      return a ? { kind: 'welcome', selector: a.selector, chain: tags.chain(a.selector), number: a.number, day: a.day, messages: a.messages, usd: a.usd, partners: a.partners.map((p) => tags.chain(p)) } : null;
    }
    case 'newcomer': {
      const a = (moments.arrivals.senders ?? []).find((s) => s.key === target.key);
      return a ? newcomerFacts(tags, a) : null;
    }
    case 'countdown': {
      const countdown = moments.countdowns.find((c) => c.metric === target.metric && c.threshold === target.threshold);
      return countdown ? { kind: 'countdown', countdown } : null;
    }
    case 'movers':
      return moversFacts(src, target.monday);
    case 'spotlight': {
      const s = moments.weeks.find((w) => w.week === target.monday)?.spotlight;
      if (!s) return null;
      const token = s.token ? { symbol: s.token.label ?? shortAddress(addressOf(s.token.key)), usd: s.token.usd } : null;
      return { kind: 'spotlight', monday: target.monday, chain: tags.chain(s.selector), spotlight: s, partners: s.partners.map((p) => tags.chain(p)), token };
    }
    case 'roundup':
      return roundupFacts(src, target.monday);
    case 'poll': {
      const poll = moments.polls.find((p) => p.week === target.monday);
      return poll ? { kind: 'poll', monday: target.monday, poll, last: moments.polls.find((p) => p.week === addDays(target.monday, -7)) ?? null } : null;
    }
  }
}
