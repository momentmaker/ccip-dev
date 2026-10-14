import { feeClassifier, senderKeyAddress } from '@ccip-dev/core';
import {
  allTimeTotal, dayTotalsFacts, RECORD_TOTAL, recordDriver, reserveDepositFacts, weekTotalsFacts,
  type DayTotalsFacts, type RecordDriver, type ReserveDepositFacts, type WeekTotalsFacts,
} from '@ccip-dev/core/broadcasts';
import { shortAddress } from '@ccip-dev/core/names';
import type { DayLeaders, DayTotals, LargestFee, Leader, ReserveFile } from '@ccip-dev/core/public';
import { recordsSetOn, type MilestoneSet, type RecordSet } from '@ccip-dev/core/records';
import type { RunContext } from '../context';
import { dayLeaderEntries, historyDays, LARGEST_FEES_LIMIT, largestFeeEntries, weekLeaderRows, type WeekLeaderRows } from '../publish';
import * as store from '../store';
import { createTagger, type Player, type Tagger } from './tags';

export interface LaneFacts {
  key: string;
  src: Player;
  dst: Player;
  usd: number | null;
  messages: number;
  feeUsd: number | null;
}

export interface TokenFacts {
  key: string;
  symbol: string;
  project: Player | null;
  usd: number | null;
  /** Share of the period's value moved. */
  sharePct: number | null;
}

export interface SenderFacts {
  key: string;
  player: Player;
  messages: number;
}

export interface ChainFeeFacts {
  key: string;
  player: Player;
  feeUsd: number | null;
}

export interface LeaderFacts {
  token: TokenFacts | null;
  sender: SenderFacts | null;
  lane: LaneFacts | null;
}

export interface DailyFacts {
  kind: 'daily';
  day: string;
  totals: DayTotalsFacts;
  leaders: LeaderFacts;
  feeChain: ChainFeeFacts | null;
  records: RecordSet[];
}

export interface WeeklyFacts {
  kind: 'weekly';
  monday: string;
  totals: WeekTotalsFacts;
  leaders: LeaderFacts;
  feeChains: ChainFeeFacts[];
}

export interface RecordFacts {
  kind: 'record';
  record: RecordSet;
  driver: RecordDriver | null;
  route: { src: Player; dst: Player } | null;
  allTime: number;
}

export interface MilestoneFacts {
  kind: 'milestone';
  milestone: MilestoneSet;
  allTime: number;
}

export interface ReserveFacts {
  kind: 'reserve';
  deposit: ReserveDepositFacts;
}

export type BroadcastFacts = DailyFacts | WeeklyFacts | RecordFacts | MilestoneFacts | ReserveFacts;

export interface FactsSource {
  history: DayTotals[];
  largest: LargestFee[];
  leaders: ReadonlyMap<string, DayLeaders>;
  week: WeekLeaderRows | null;
  tags: Tagger;
}

/**
 * Reads what the finalize broadcasts for `days` (and the week from `monday`) need from D1, through the functions that build
 * history.json and day-leaders.json, so a caption and its card show the same numbers.
 */
export async function loadFactsSource(c: RunContext, o: { days: readonly string[]; monday: string | null }): Promise<FactsSource> {
  const sorted = [...o.days].sort();
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const history = await historyDays(c);
  const largest = await largestFeeEntries(c, last, LARGEST_FEES_LIMIT, feeClassifier(await store.linkFeeTokens(c.env.DB)));
  const leaders = new Map((await dayLeaderEntries(c, first, last)).map((d) => [d.day, d]));
  const week = o.monday === null ? null : await weekLeaderRows(c, o.monday);
  const tokenKeys = [...[...leaders.values()].flatMap((d) => (d.token ? [d.token.key] : [])), ...(week?.token ? [week.token.key] : [])];
  return { history, largest, leaders, week, tags: await createTagger(c, tokenKeys) };
}

const laneEnds = (key: string): [string, string] => {
  const [src = '', dst = ''] = key.split('>');
  return [src, dst];
};

function laneFacts(tags: Tagger, l: Leader): LaneFacts {
  const [src, dst] = laneEnds(l.key);
  return { key: l.key, src: tags.chain(src), dst: tags.chain(dst), usd: l.usd, messages: l.messages, feeUsd: l.fee_usd };
}

function leaderFacts(tags: Tagger, token: Leader | null, sender: Leader | null, lane: Leader | null, periodValue: number | null): LeaderFacts {
  return {
    token: token
      ? {
          key: token.key,
          symbol: token.label ?? shortAddress(token.key.slice(token.key.indexOf(':') + 1)),
          project: tags.tokenProject(token.key),
          usd: token.usd,
          sharePct: token.usd === null || !periodValue ? null : (token.usd / periodValue) * 100,
        }
      : null,
    sender: sender ? { key: sender.key, player: { name: sender.label ?? shortAddress(senderKeyAddress(sender.key)), x: sender.x ?? null }, messages: sender.messages } : null,
    lane: lane ? laneFacts(tags, lane) : null,
  };
}

const chainFee = (tags: Tagger, l: Leader): ChainFeeFacts => ({ key: l.key, player: tags.chain(l.key), feeUsd: l.fee_usd });

export function dailyFacts(src: FactsSource, day: string): DailyFacts | null {
  const totals = dayTotalsFacts(src.history, day);
  if (totals === null) return null;
  const lead = src.leaders.get(day) ?? null;
  return {
    kind: 'daily',
    day,
    totals,
    leaders: leaderFacts(src.tags, lead?.token ?? null, lead?.sender ?? null, lead?.lane ?? null, totals.value.value),
    feeChain: lead?.fee_chain ? chainFee(src.tags, lead.fee_chain) : null,
    records: recordsSetOn(src.history, src.largest, day),
  };
}

export function weeklyFacts(src: FactsSource, monday: string): WeeklyFacts | null {
  const totals = weekTotalsFacts(src.history, monday);
  if (totals === null || src.week === null) return null;
  return {
    kind: 'weekly',
    monday,
    totals,
    leaders: leaderFacts(src.tags, src.week.token, src.week.sender, src.week.lane, totals.value.value),
    feeChains: src.week.feeChains.map((l) => chainFee(src.tags, l)),
  };
}

export function recordFacts(src: FactsSource, record: RecordSet): RecordFacts {
  const driver = recordDriver(record, src.leaders.get(record.day) ?? null, src.largest);
  const route = driver ? laneEnds(driver.lane) : null;
  return {
    kind: 'record',
    record,
    driver,
    route: route ? { src: src.tags.chain(route[0]), dst: src.tags.chain(route[1]) } : null,
    allTime: allTimeTotal(RECORD_TOTAL[record.kind], src.history, record.day),
  };
}

export function milestoneFacts(src: FactsSource, milestone: MilestoneSet): MilestoneFacts {
  return { kind: 'milestone', milestone, allTime: allTimeTotal(milestone.metric, src.history, milestone.day) };
}

export function reserveFacts(reserve: Pick<ReserveFile, 'transfers' | 'weekly'>, tx: string): ReserveFacts | null {
  const deposit = reserveDepositFacts(reserve, tx);
  return deposit ? { kind: 'reserve', deposit } : null;
}
