import { identityResolver, labeledAddresses, mergeIdentities, rankIdentities, type IdentityOrder, type IdentityResolver, type IdentityTotals } from '@ccip-dev/core';
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
