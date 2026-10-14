import {
  addressKey, claimedTokenKeys, dayStartIso, identityResolver, labelCoverage, labeledAddresses, mergeIdentities, newcomerPicks, NEWCOMER_MIN_MESSAGES, NEWCOMER_TOP,
  projectAddresses, rankIdentities, senderKeyAddress, splitViaToken, tokenClaims, viaTokenCredits, type DailyBreakdown, type IdentityOrder, type IdentityResolver,
  type IdentityTotals, type LabelCoverage, type LabelIndex, type SenderRow, type TokenClaims, type ViaTokenCredit,
} from '@ccip-dev/core';
import type { SenderArrival } from '@ccip-dev/core/public';
import type { RunContext } from './context';
import * as store from './store';

/** What every identity ranking needs: the resolver, the addresses the store splits labeled rows by, and the token claims. */
export interface SenderBook {
  resolve: IdentityResolver;
  labeled: string[];
  claims: TokenClaims;
  /** Every key a claim is made by, as the store's via-token queries take them. */
  claimed: string[];
}

export async function senderBook(c: RunContext): Promise<SenderBook> {
  const db = c.env.DB;
  const chains = await store.senderChains(db);
  const claims = tokenClaims(c.labelTokens, c.projects, chains, await store.registryGroups(db, claimedTokenKeys(c.labelTokens, chains)));
  return { resolve: identityResolver(c.labels, chains), labeled: labeledAddresses(c.labels), claims, claimed: [...claims.keys()] };
}

/** The window's claimed direct sends by senders no label names, credited to the projects that claim the tokens. */
export async function windowCredits(c: RunContext, book: SenderBook, fromDay: string | null, toDay: string): Promise<ViaTokenCredit[]> {
  return viaTokenCredits(await store.viaTokenCreditsOf(c.env.DB, fromDay, toDay, book.claimed, book.labeled), book.claims);
}

/** One day's identities from its sender and via_token rows, one row per key, as finalize and today.json have them. */
export function identitiesOf(book: Pick<SenderBook, 'resolve' | 'labeled' | 'claims'>, senderRows: readonly SenderRow[], viaRows: readonly SenderRow[]): IdentityTotals[] {
  const { senders, credits } = splitViaToken(senderRows, viaRows, book.claims, new Set(book.labeled));
  return mergeIdentities(senders, book.resolve, viaTokenCredits(credits, book.claims));
}

/** The top `limit` identities over [fromDay, toDay]: every labeled row, the busiest unlabeled addresses net of the move, and the credits. */
export async function rankedIdentities(
  c: RunContext,
  book: SenderBook,
  fromDay: string | null,
  toDay: string,
  order: IdentityOrder,
  limit: number,
): Promise<IdentityTotals[]> {
  const db = c.env.DB;
  const rows = [
    ...(await store.senderTotalsOf(db, fromDay, toDay, book.labeled)),
    ...(await store.topUnlabeledSenders(db, fromDay, toDay, book.labeled, limit, order, book.claimed)),
  ];
  return rankIdentities(mergeIdentities(rows, book.resolve, await windowCredits(c, book, fromDay, toDay)), order, limit);
}

function byDay(rows: readonly store.LeaderRow[]): Map<string, store.LeaderRow[]> {
  const days = new Map<string, store.LeaderRow[]>();
  for (const r of rows) {
    const list = days.get(r.day);
    if (list) list.push(r);
    else days.set(r.day, [r]);
  }
  return days;
}

/** Each day's top identity by messages, from that day's labeled rows, its busiest unlabeled address net of the move, and its credits. */
export function topIdentityByDay(book: Pick<SenderBook, 'resolve' | 'claims'>, rows: readonly store.LeaderRow[], creditRows: readonly store.LeaderRow[]): Map<string, IdentityTotals> {
  const senders = byDay(rows);
  const credits = byDay(creditRows);
  const top = new Map<string, IdentityTotals>();
  for (const day of new Set([...senders.keys(), ...credits.keys()])) {
    const [first] = rankIdentities(mergeIdentities(senders.get(day) ?? [], book.resolve, viaTokenCredits(credits.get(day) ?? [], book.claims)), 'messages', 1);
    if (first) top.set(day, first);
  }
  return top;
}

export const LABEL_COVERAGE_KEY = 'label_coverage';

/** The labeled identities' share of [fromDay, toDay]: every labeled row and every credit merged, against daily_totals. */
export async function labelCoverageOf(c: RunContext, book: SenderBook, fromDay: string, toDay: string): Promise<LabelCoverage> {
  const rows = await store.senderTotalsOf(c.env.DB, fromDay, toDay, book.labeled);
  return labelCoverage(mergeIdentities(rows, book.resolve, await windowCredits(c, book, fromDay, toDay)), await store.totalsBetween(c.env.DB, fromDay, toDay));
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
