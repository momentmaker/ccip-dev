import {
  addressKey, dayStartIso, identityResolver, labelCoverage, labeledAddresses, mergeIdentities, newcomerPicks, NEWCOMER_MIN_MESSAGES, NEWCOMER_TOP, projectAddresses,
  rankIdentities, senderKeyAddress, type DailyBreakdown, type IdentityOrder, type IdentityResolver, type IdentityTotals, type LabelCoverage, type LabelIndex,
} from '@ccip-dev/core';
import type { SenderArrival } from '@ccip-dev/core/public';
import type { RunContext } from './context';
import * as store from './store';

/** What every identity ranking needs: the resolver, and the addresses the store splits labeled rows by. */
export interface SenderBook {
  resolve: IdentityResolver;
  labeled: string[];
}

export async function senderBook(c: RunContext): Promise<SenderBook> {
  return { resolve: identityResolver(c.labels, await store.senderChains(c.env.DB)), labeled: labeledAddresses(c.labels) };
}

/** The top `limit` identities over [fromDay, toDay]: every labeled row, plus the busiest unlabeled addresses, merged. */
export async function rankedIdentities(
  c: RunContext,
  book: SenderBook,
  fromDay: string | null,
  toDay: string,
  order: IdentityOrder,
  limit: number,
): Promise<IdentityTotals[]> {
  const db = c.env.DB;
  const rows = [...(await store.senderTotalsOf(db, fromDay, toDay, book.labeled)), ...(await store.topUnlabeledSenders(db, fromDay, toDay, book.labeled, limit, order))];
  return rankIdentities(mergeIdentities(rows, book.resolve), order, limit);
}

/** Each day's top identity by messages, from that day's labeled rows and its busiest unlabeled address. */
export function topIdentityByDay(rows: readonly store.LeaderRow[], resolve: IdentityResolver): Map<string, IdentityTotals> {
  const byDay = new Map<string, store.LeaderRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  const top = new Map<string, IdentityTotals>();
  for (const [day, list] of byDay) {
    const [first] = rankIdentities(mergeIdentities(list, resolve), 'messages', 1);
    if (first) top.set(day, first);
  }
  return top;
}

export const LABEL_COVERAGE_KEY = 'label_coverage';

/** The labeled identities' share of [fromDay, toDay]: every labeled row merged, against daily_totals. */
export async function labelCoverageOf(c: RunContext, book: SenderBook, fromDay: string, toDay: string): Promise<LabelCoverage> {
  const rows = await store.senderTotalsOf(c.env.DB, fromDay, toDay, book.labeled);
  return labelCoverage(mergeIdentities(rows, book.resolve), await store.totalsBetween(c.env.DB, fromDay, toDay));
}

/** An identity's addresses: those it sent from, plus, for a project, every address its label names. */
export function identityAddresses(labels: LabelIndex, identity: IdentityTotals): string[] {
  return [...new Set([...identity.keys.map(senderKeyAddress), ...(identity.slug === null ? [] : projectAddresses(labels, identity.slug))])];
}

/** Each identity's first day: the earliest message from any of its addresses, on any chain. */
export async function identityFirstDays(c: RunContext, identities: readonly IdentityTotals[]): Promise<Map<string, string>> {
  const addressesOf = new Map(identities.map((i) => [i.key, identityAddresses(c.labels, i)]));
  const firsts = await store.firstSenderDays(c.env.DB, [...new Set([...addressesOf.values()].flat())]);
  const out = new Map<string, string>();
  for (const [key, addresses] of addressesOf) {
    const days = addresses.flatMap((a) => firsts.get(a) ?? []).sort();
    if (days[0] !== undefined) out.set(key, days[0]);
  }
  return out;
}

/** The identities already recorded, by their own key or, once labeled, by an `address:` key of any address they hold. */
async function recordedIdentities(c: RunContext, identities: readonly IdentityTotals[]): Promise<Set<string>> {
  const keysOf = new Map(identities.map((i) => [i.key, [i.key, ...identityAddresses(c.labels, i).map(addressKey)]]));
  const existing = await store.existingArrivals(c.env.DB, 'sender', [...new Set([...keysOf.values()].flat())]);
  return new Set([...keysOf].filter(([, keys]) => keys.some((k) => existing.has(k))).map(([key]) => key));
}

/** Records the day's new identities (see newcomerPicks) in arrivals, once each, and returns their keys. */
export async function recordSenderArrivals(c: RunContext, day: string, breakdown: readonly DailyBreakdown[]): Promise<string[]> {
  const db = c.env.DB;
  const book = await senderBook(c);
  const identities = mergeIdentities(breakdown.filter((b) => b.dim === 'sender'), book.resolve);
  const top = rankIdentities(identities, 'messages', NEWCOMER_TOP).filter((i) => i.messages >= NEWCOMER_MIN_MESSAGES);
  if (top.length === 0) return [];
  const recorded = await recordedIdentities(c, top);
  const fresh = top.filter((i) => !recorded.has(i.key));
  if (fresh.length === 0) return [];
  const keys = newcomerPicks(identities, await identityFirstDays(c, fresh), day, recorded).map((p) => p.identity.key);
  await store.insertArrivals(db, 'sender', keys, dayStartIso(day), null);
  return keys;
}

/** The senders recorded from `since` through `lastDay`, as moments.json lists them. */
export async function senderArrivals(c: RunContext, since: string, lastDay: string): Promise<SenderArrival[]> {
  const db = c.env.DB;
  const rows = (await store.senderArrivalsSince(db, dayStartIso(since))).filter((r) => r.first_seen.slice(0, 10) <= lastDay);
  if (rows.length === 0) return [];
  const book = await senderBook(c);
  const out: SenderArrival[] = [];
  for (const row of rows) {
    const day = row.first_seen.slice(0, 10);
    const ranked = rankIdentities(mergeIdentities(await store.breakdownBetween(db, 'sender', day, day), book.resolve), 'messages', Infinity);
    const rank = ranked.findIndex((i) => i.key === row.key);
    const identity = ranked[rank];
    if (identity === undefined) continue;
    const firstDay = (await identityFirstDays(c, [identity])).get(identity.key) ?? day;
    const sinceFirst = mergeIdentities(await store.senderTotalsOf(db, firstDay, day, identityAddresses(c.labels, identity)), book.resolve).find((i) => i.key === identity.key);
    out.push({
      key: identity.key,
      label: identity.label,
      x: identity.inferred ? null : identity.x,
      kind: identity.kind,
      inferred: identity.inferred,
      day,
      first_day: firstDay,
      rank: rank + 1,
      messages: identity.messages,
      total_messages: sinceFirst?.messages ?? identity.messages,
      chains: identity.chains,
    });
  }
  return out;
}
