import { addDays, lastCompleteMonday, mergeIdentities, normalizeAddress, weekStart, type Dim, type IdentityTotals } from '@ccip-dev/core';
import {
  BOARD_SIZE, countdownsOf, parsePollRecord, pollAnswer, pollQuestion, pollRecordKey, projectSpotlightPick, rankBoard, SPOTLIGHT_SINCE, spotlightPicks, voteShares,
  type ChainArrival, type LaneArrival, type MomentsBody, type PollData, type PollResult, type TokenArrival,
} from '@ccip-dev/core/moments';
import { chainName, chainNameMap, laneLabel, type ChainNames } from '@ccip-dev/core/names';
import type { BoardEntry, DayTotals, MomentsWeek, Poll, ProjectSpotlight, Spotlight } from '@ccip-dev/core/public';
import type { RunContext } from './context';
import { senderArrivals, senderBook, type SenderBook } from './senders';
import * as store from './store';

export const ARRIVAL_DAYS = 30;
export const MOMENT_WEEKS = 8;
export const POLL_WEEKS = 8;
const FIRST_PARTNERS = 10;
const SPOTLIGHT_PARTNERS = 3;
/** More rows than any week holds for one dimension, so topBetween returns them all. */
const ALL_ROWS = 100_000;

export interface MomentsInputs {
  /** The last finalized day; the moments are as of its end. */
  lastDay: string;
  /** history.json's day rows. */
  days: readonly DayTotals[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cents = (v: number) => Math.round(v * 100) / 100;
const centsOrNull = (v: number | null) => (v === null ? null : cents(v));
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

function laneEnds(key: string): [string, string] | null {
  const parts = key.split('>');
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

function splitKey(key: string): { chain: string; address: string } {
  const at = key.indexOf(':');
  return { chain: key.slice(0, at), address: key.slice(at + 1) };
}

const tokenKey = (key: string) => {
  const { chain, address } = splitKey(key);
  return `${chain}:${normalizeAddress(address)}`;
};

/**
 * Everything moments.json publishes, from D1, as of the end of `lastDay`. It reads the same rows and rankings
 * (topBetween, history.json's days) as the other public files, so a moment's numbers match the rest of the site.
 */
export async function buildMoments(c: RunContext, { lastDay, days }: MomentsInputs): Promise<MomentsBody> {
  const db = c.env.DB;
  const names = chainNameMap([...(await store.chainDisplayNames(db))].map(([selector, n]) => ({ selector, ...n })));
  const lanes = await store.firstDays(db, 'lane');
  const chainFirst = chainFirstDays(lanes);
  const since = addDays(lastDay, -(ARRIVAL_DAYS - 1));
  const recentLanes = await store.breakdownBetween(db, 'lane', since, lastDay);
  const weeks = await momentWeeks(c, lastDay, chainFirst);
  return {
    network: { chains: chainFirst.size, lanes: lanes.length },
    arrivals: {
      chains: chainArrivals(chainFirst, recentLanes, since),
      lanes: laneArrivals(lanes, recentLanes, since),
      tokens: await tokenArrivals(c, since, lastDay),
      senders: await senderArrivals(c, since, lastDay),
    },
    weeks,
    countdowns: countdownsOf(days),
    polls: await pollsOf(c, lastDay, days, weeks, names),
  };
}

/** A chain's first day is the first day it is on either end of a lane, as in replay.json. */
function chainFirstDays(lanes: readonly store.FirstDayRow[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const lane of lanes) {
    for (const selector of laneEnds(lane.key) ?? []) {
      const day = first.get(selector);
      if (day === undefined || lane.first_day < day) first.set(selector, lane.first_day);
    }
  }
  return first;
}

/** A chain's number is its place among every chain by first day, and on a shared first day by selector (compared as text), so each number is unique. */
function chainArrivals(chainFirst: ReadonlyMap<string, string>, recentLanes: readonly store.LeaderRow[], since: string): ChainArrival[] {
  return [...chainFirst]
    .sort(([a, dayA], [b, dayB]) => compare(dayA, dayB) || compare(a, b))
    .map(([selector, day], i) => ({ selector, day, number: i + 1 }))
    .filter(({ day }) => day >= since)
    .map(({ selector, day, number }) => {
      const rows = recentLanes.filter((r) => r.day === day && laneEnds(r.key)?.includes(selector));
      const partners = new Map<string, number>();
      for (const r of rows) {
        const other = laneEnds(r.key)!.find((s) => s !== selector)!;
        partners.set(other, (partners.get(other) ?? 0) + r.usd_value);
      }
      return {
        selector,
        day,
        number,
        partners: [...partners].sort(([a, va], [b, vb]) => vb - va || compare(a, b)).slice(0, FIRST_PARTNERS).map(([s]) => s),
        messages: sum(rows.map((r) => r.messages)),
        usd: cents(sum(rows.map((r) => r.usd_value))),
      };
    });
}

function laneArrivals(lanes: readonly store.FirstDayRow[], recentLanes: readonly store.LeaderRow[], since: string): LaneArrival[] {
  return lanes
    .filter((l) => l.first_day >= since)
    .map((l) => {
      const row = recentLanes.find((r) => r.day === l.first_day && r.key === l.key);
      return { key: l.key, day: l.first_day, messages: row?.messages ?? 0, usd: cents(row?.usd_value ?? 0) };
    })
    .sort((a, b) => compare(a.day, b.day) || b.usd - a.usd || compare(a.key, b.key));
}

/** A registry group arrives with its first message on any of its chains; a token outside the registry arrives on its own. */
async function tokenArrivals(c: RunContext, since: string, lastDay: string): Promise<TokenArrival[]> {
  const db = c.env.DB;
  const first = await store.firstDays(db, 'token');
  const fresh = first.filter((t) => t.first_day >= since);
  if (fresh.length === 0) return [];
  const firstOf = new Map(first.map((t) => [tokenKey(t.key), t.first_day]));
  const usdOn = new Map((await store.breakdownBetween(db, 'token', since, lastDay)).map((r) => [`${r.day}|${tokenKey(r.key)}`, r.usd_value]));
  const groupOf = await store.tokenGroupIds(db, fresh.map((t) => splitKey(t.key)));
  const groups = [...new Set(fresh.flatMap((t) => groupOf.get(tokenKey(t.key)) ?? []))];
  const members = await store.tokenGroupMembers(db, groups);
  const out: TokenArrival[] = [];
  for (const group of groups) {
    const moved = members
      .filter((m) => m.group_id === group)
      .flatMap((m) => {
        const key = `${m.chain}:${normalizeAddress(m.address)}`;
        const day = firstOf.get(key);
        return day === undefined ? [] : [{ key, day, chain: m.chain, symbol: m.symbol }];
      });
    const day = moved.map((m) => m.day).sort()[0];
    if (day === undefined || day < since) continue;
    const onFirstDay = moved
      .filter((m) => m.day === day)
      .map((m) => ({ ...m, usd: usdOn.get(`${day}|${m.key}`) ?? 0 }))
      .sort((a, b) => b.usd - a.usd || compare(a.chain, b.chain));
    out.push({ key: group, symbol: onFirstDay[0]?.symbol ?? null, day, chains: [...new Set(onFirstDay.map((m) => m.chain))], usd: cents(sum(onFirstDay.map((m) => m.usd))) });
  }
  const ungrouped = fresh.filter((t) => !groupOf.get(tokenKey(t.key)));
  const symbols = await store.tokenSymbols(db, ungrouped.map((t) => splitKey(t.key)));
  for (const t of ungrouped) {
    const key = tokenKey(t.key);
    out.push({ key, symbol: symbols.get(key) ?? null, day: t.first_day, chains: [splitKey(key).chain], usd: cents(usdOn.get(`${t.first_day}|${key}`) ?? 0) });
  }
  return out.sort((a, b) => compare(a.day, b.day) || b.usd - a.usd || compare(a.key, b.key));
}

type Top = (dim: Dim, order: store.TopOrder, monday: string, limit: number) => Promise<store.BreakdownRow[]>;

/** topBetween over a Monday–Sunday week, each query run once per build. */
function weekTops(db: D1Database): Top {
  const cache = new Map<string, Promise<store.BreakdownRow[]>>();
  return (dim, order, monday, limit) => {
    const key = `${dim}|${order}|${monday}|${limit}`;
    let rows = cache.get(key);
    if (rows === undefined) {
      rows = store.topBetween(db, dim, monday, addDays(monday, 6), limit, order);
      cache.set(key, rows);
    }
    return rows;
  };
}

/** The last 8 complete weeks: their boards against the week before, and their spotlight. */
async function momentWeeks(c: RunContext, lastDay: string, chainFirst: ReadonlyMap<string, string>): Promise<MomentsWeek[]> {
  const db = c.env.DB;
  const top = weekTops(db);
  const latest = lastCompleteMonday(lastDay);
  const mondays = Array.from({ length: MOMENT_WEEKS }, (_, i) => addDays(latest, -7 * (MOMENT_WEEKS - 1 - i)));
  const tokenKeys = (await Promise.all(mondays.map((m) => top('token', 'value', m, BOARD_SIZE)))).flat().map((r) => r.key);
  const symbols = await store.tokenSymbols(db, tokenKeys.map(splitKey));
  const board = async (dim: Dim, order: store.TopOrder, monday: string, value: (r: store.BreakdownRow) => number, label: (key: string) => string | null): Promise<BoardEntry[]> =>
    rankBoard(
      (await top(dim, order, monday, BOARD_SIZE)).map((r) => ({ key: r.key, label: label(r.key), value: value(r) })),
      await top(dim, order, addDays(monday, -7), BOARD_SIZE),
    );
  const picks = await spotlightPicksFor(db, mondays, latest, chainFirst);
  const projects = projectWeeks(c, await senderBook(c));
  const weeks: MomentsWeek[] = [];
  for (const monday of mondays) {
    const pick = picks.get(monday) ?? null;
    weeks.push({
      week: monday,
      boards: {
        fee_chains: await board('src_chain', 'fees', monday, (r) => cents(r.fee_usd ?? 0), () => null),
        tokens: await board('token', 'value', monday, (r) => cents(r.usd_value), (key) => symbols.get(tokenKey(key)) ?? null),
        lanes: await board('lane', 'value', monday, (r) => cents(r.usd_value), () => null),
      },
      spotlight: pick === null ? null : await spotlightOf(c, top, monday, pick),
      project: await projectSpotlightOf(projects, monday),
    });
  }
  return weeks;
}

type ProjectWeeks = (monday: string) => Promise<IdentityTotals[]>;

/** Each Monday–Sunday week's labeled projects, merged from every labeled row, each week read once per build. */
function projectWeeks(c: RunContext, book: SenderBook): ProjectWeeks {
  const cache = new Map<string, Promise<IdentityTotals[]>>();
  return (monday) => {
    let found = cache.get(monday);
    if (found === undefined) {
      found = store
        .senderTotalsOf(c.env.DB, monday, addDays(monday, 6), book.labeled)
        .then((rows) => mergeIdentities(rows, book.resolve).filter((i) => i.slug !== null));
      cache.set(monday, found);
    }
    return found;
  };
}

async function projectSpotlightOf(weeks: ProjectWeeks, monday: string): Promise<ProjectSpotlight | null> {
  const now = await weeks(monday);
  const before = new Map((await weeks(addDays(monday, -7))).map((p) => [p.key, p.messages]));
  const key = projectSpotlightPick(now.map((p) => ({ key: p.key, messages: p.messages, previous: before.get(p.key) ?? 0 })));
  const p = now.find((x) => x.key === key);
  if (p === undefined || p.slug === null || p.label === null || p.kind === null) return null;
  return {
    key: p.key,
    slug: p.slug,
    name: p.label,
    x: p.x,
    kind: p.kind,
    inferred: p.inferred,
    messages: p.messages,
    previous_messages: before.get(p.key) ?? 0,
    usd: cents(p.usd_value),
    fee_usd: centsOrNull(p.fee_usd),
    chains: p.chains,
  };
}

/** Picks run from the earlier of SPOTLIGHT_SINCE and the oldest published week, so the 4-week skip sees every posted pick. */
async function spotlightPicksFor(db: D1Database, mondays: readonly string[], latest: string, chainFirst: ReadonlyMap<string, string>): Promise<Map<string, string | null>> {
  const start = mondays[0]! < SPOTLIGHT_SINCE ? mondays[0]! : SPOTLIGHT_SINCE;
  const byWeek = new Map<string, Map<string, number>>();
  for (const r of await store.chainWeekMessages(db, addDays(start, -7), addDays(latest, 6))) {
    const week = byWeek.get(r.week) ?? new Map<string, number>();
    week.set(r.key, r.messages);
    byWeek.set(r.week, week);
  }
  const series = [];
  for (let monday = start; monday <= latest; monday = addDays(monday, 7)) {
    const before = byWeek.get(addDays(monday, -7));
    series.push({
      monday,
      chains: [...(byWeek.get(monday) ?? [])].map(([selector, messages]) => ({ selector, messages, previous: before?.get(selector) ?? 0, firstDay: chainFirst.get(selector) ?? monday })),
    });
  }
  return spotlightPicks(series);
}

async function spotlightOf(c: RunContext, top: Top, monday: string, selector: string): Promise<Spotlight> {
  const totals = async (week: string) => {
    const src = (await top('src_chain', 'value', week, ALL_ROWS)).find((r) => r.key === selector);
    const dst = (await top('dst_chain', 'value', week, ALL_ROWS)).find((r) => r.key === selector);
    return { messages: (src?.messages ?? 0) + (dst?.messages ?? 0), usd: (src?.usd_value ?? 0) + (dst?.usd_value ?? 0), fee: src?.fee_usd ?? null };
  };
  const now = await totals(monday);
  const before = await totals(addDays(monday, -7));
  const messagesBy = new Map<string, number>();
  for (const dim of ['src_chain', 'dst_chain'] as const) {
    for (const r of await top(dim, 'value', monday, ALL_ROWS)) messagesBy.set(r.key, (messagesBy.get(r.key) ?? 0) + r.messages);
  }
  const rank = [...messagesBy].sort(([a, x], [b, y]) => y - x || compare(a, b)).findIndex(([s]) => s === selector) + 1;
  const partners = new Map<string, number>();
  for (const r of await top('lane', 'value', monday, ALL_ROWS)) {
    const ends = laneEnds(r.key);
    if (ends === null || !ends.includes(selector)) continue;
    const other = ends[0] === selector ? ends[1] : ends[0];
    partners.set(other, (partners.get(other) ?? 0) + r.usd_value);
  }
  const token = (await top('token', 'value', monday, ALL_ROWS)).find((r) => r.key.startsWith(`${selector}:`)) ?? null;
  const symbol = token === null ? null : ((await store.tokenSymbols(c.env.DB, [splitKey(token.key)])).get(tokenKey(token.key)) ?? null);
  return {
    selector,
    rank,
    messages: now.messages,
    previous_messages: before.messages,
    usd: cents(now.usd),
    previous_usd: cents(before.usd),
    fee_usd: centsOrNull(now.fee),
    previous_fee_usd: centsOrNull(before.fee),
    partners: [...partners].sort(([a, va], [b, vb]) => vb - va || compare(a, b)).slice(0, SPOTLIGHT_PARTNERS).map(([s]) => s),
    token: token === null ? null : { key: token.key, label: symbol, usd: cents(token.usd_value) },
  };
}

/**
 * This week's poll (still open, so unanswered) and each of the 7 before it that was sent. A sent poll is described by
 * its record, which holds what was asked; its answer comes once its week is in history.json, and its votes once closed.
 */
async function pollsOf(c: RunContext, lastDay: string, days: readonly DayTotals[], weeks: readonly MomentsWeek[], names: ChainNames): Promise<Poll[]> {
  const current = weekStart(addDays(lastDay, 1));
  const mondays = Array.from({ length: POLL_WEEKS }, (_, i) => addDays(current, -7 * (POLL_WEEKS - 1 - i)));
  const records = await store.getMetas(c.env.DB, mondays.map(pollRecordKey));
  const byWeek = new Map(weeks.map((w) => [w.week, w]));
  const finalized = new Set(days.map((d) => d.day));
  const complete = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i)).every((d) => finalized.has(d));
  const feeTotal = (monday: string): number | null => {
    const week = days.filter((d) => d.day >= monday && d.day <= addDays(monday, 6) && d.fee_usd !== null);
    return week.length === 0 ? null : cents(sum(week.map((d) => d.fee_usd!)));
  };
  const chain = (e: BoardEntry) => ({ key: e.key, label: chainName(names, e.key), value: e.value });
  const lane = (e: BoardEntry) => ({ key: e.key, label: laneLabel(names, e.key), value: e.value });
  const askedFrom = (monday: string): PollData => {
    const week = byWeek.get(addDays(monday, -7));
    return { feeChains: (week?.boards.fee_chains ?? []).map(chain), lanes: (week?.boards.lanes ?? []).map(lane), feeTotal: feeTotal(addDays(monday, -7)) };
  };
  const resultOf = (monday: string): PollResult => {
    const week = byWeek.get(monday);
    const feeChain = week?.boards.fee_chains[0];
    const topLane = week?.boards.lanes[0];
    return { feeChain: feeChain ? chain(feeChain) : null, lane: topLane ? lane(topLane) : null, feeTotal: feeTotal(monday), previousFeeTotal: feeTotal(addDays(monday, -7)) };
  };
  return mondays.flatMap((monday): Poll[] => {
    const record = parsePollRecord(records.get(pollRecordKey(monday)) ?? null);
    const asked = record ?? (monday === current ? pollQuestion(monday, askedFrom(monday)) : null);
    if (asked === null) return [];
    const { answer, outcome } = complete(monday) ? pollAnswer(asked, resultOf(monday)) : { answer: null, outcome: null };
    return [{
      week: monday,
      question_kind: asked.question_kind,
      question: asked.question,
      options: asked.options,
      answer,
      outcome,
      votes: record?.voters ? voteShares(record.voters) : null,
      total_votes: record?.total_voters ?? null,
    }];
  });
}
