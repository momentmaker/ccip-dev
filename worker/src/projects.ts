import {
  addDays, daysBetween, mergeIdentities, projectKey, senderKeyAddress, sharePct, viaTokenCredits, type IdentityTotals, type RegistryEntry, type SenderIdentity,
} from '@ccip-dev/core';
import type { ProjectsFile } from '@ccip-dev/core/public';
import { byName } from '@ccip-dev/core/roster';
import type { RunContext } from './context';
import { senderBook, windowCredits } from './senders';
import * as store from './store';

export type ProjectsBody = Omit<ProjectsFile, 'schema_version' | 'updated_at' | 'attribution'>;
type Project = ProjectsBody['projects'][number];
type ProjectWindow = Project['totals']['7d'];

/** A project page's series, chains and lanes cover the last 30 finalized days, as Top's 30-day window does. */
export const PROJECT_DAYS = 30;
export const PROJECT_LANES = 5;

const cents = (v: number) => Math.round(v * 100) / 100;

function windowOf(identity: IdentityTotals | undefined, total: store.WindowTotals): ProjectWindow {
  return {
    messages: identity?.messages ?? 0,
    usd: cents(identity?.usd_value ?? 0),
    fee_usd: identity === undefined || identity.fee_usd === null ? null : cents(identity.fee_usd),
    share_pct: sharePct(identity?.messages ?? 0, total.messages),
    via_token_messages: identity?.via_token_messages ?? 0,
    via_token_usd: cents(identity?.via_token_usd ?? 0),
  };
}

/** The project's `[[tokens]]` on chains CCIP knows, by selector. */
function claimedTokens(entry: RegistryEntry, selectorOf: ReadonlyMap<string, string>): { chain: string; address: string; source: string }[] {
  return entry.tokens.flatMap((t) => {
    const chain = selectorOf.get(t.chain);
    return chain === undefined ? [] : [{ chain, address: t.address, source: t.source }];
  });
}

export async function buildProjects(c: RunContext, lastDay: string): Promise<ProjectsBody> {
  const db = c.env.DB;
  const book = await senderBook(c);
  const from7 = addDays(lastDay, -6);
  const from30 = addDays(lastDay, -(PROJECT_DAYS - 1));
  const dayRows = await store.senderDaysOf(db, from30, lastDay, book.labeled);
  const creditDays = await store.viaTokenCreditDays(db, from30, lastDay, book.claimed, book.labeled);
  const creditsOf = (rows: readonly store.LeaderRow[]) => viaTokenCredits(rows, book.claims);
  const month = mergeIdentities(dayRows, book.resolve, creditsOf(creditDays));
  const week = mergeIdentities(dayRows.filter((r) => r.day >= from7), book.resolve, creditsOf(creditDays.filter((r) => r.day >= from7)));
  const allTime = mergeIdentities(await store.senderTotalsOf(db, null, lastDay, book.labeled), book.resolve, await windowCredits(c, book, null, lastDay));
  const totals = {
    '7d': await store.totalsBetween(db, from7, lastDay),
    '30d': await store.totalsBetween(db, from30, lastDay),
    all: await store.totalsBetween(db, null, lastDay),
  };
  const projectKeys = month.filter((i) => i.slug !== null).flatMap((i) => i.keys);
  const lanes = projectKeys.length === 0 ? [] : await store.senderLanes(db, from30, lastDay, projectKeys);
  const selectorOf = new Map([...(await store.senderChains(db))].map(([selector, chain]) => [chain.name, selector]));
  const symbols = await store.tokenSymbols(db, Object.values(c.projects).flatMap((entry) => claimedTokens(entry, selectorOf)));
  const identityOfKey = (key: string) => book.resolve(key.slice(0, key.indexOf(':')), senderKeyAddress(key));
  const days = daysBetween(from30, lastDay);

  const projects = Object.entries(c.projects).map(([slug, entry]): Project => {
    const key = projectKey(slug);
    const find = (list: readonly IdentityTotals[]) => list.find((i) => i.key === key);
    const thisMonth = find(month);
    const perDay = new Map<string, number>();
    for (const r of dayRows) if (identityOfKey(r.key).key === key) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.messages);
    for (const r of creditDays) {
      const [credit] = creditsOf([r]);
      if (credit !== undefined && projectKey(credit.project.slug) === key) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.messages);
    }
    return {
      slug,
      name: entry.name,
      x: entry.x,
      url: entry.url,
      kind: entry.kind,
      source: entry.source,
      totals: { '7d': windowOf(find(week), totals['7d']), '30d': windowOf(thisMonth, totals['30d']), all: windowOf(find(allTime), totals.all) },
      series: days.map((day) => ({ day, messages: perDay.get(day) ?? 0 })),
      chains: thisMonth?.chains ?? [],
      ...lanesOf(lanes.filter((l) => thisMonth?.keys.includes(l.key) ?? false)),
      addresses: addressesOf(entry, thisMonth, selectorOf, identityOfKey),
      tokens: claimedTokens(entry, selectorOf).map((t) => ({ ...t, symbol: symbols.get(`${t.chain}:${t.address}`) ?? null })),
    };
  });
  projects.sort((a, b) => b.totals['7d'].messages - a.totals['7d'].messages || byName(a.name, b.name));
  return { from: from30, to: lastDay, projects };
}

function lanesOf(rows: readonly store.SenderLaneRow[]): Pick<Project, 'lanes' | 'split'> {
  const byLane = new Map<string, { src: string; dst: string; messages: number; usd: number }>();
  let data = 0;
  let messages = 0;
  for (const r of rows) {
    const src = r.key.slice(0, r.key.indexOf(':'));
    const id = `${src}>${r.dst_chain}`;
    const lane = byLane.get(id) ?? { src, dst: r.dst_chain, messages: 0, usd: 0 };
    lane.messages += r.messages;
    lane.usd += r.usd_value;
    byLane.set(id, lane);
    data += r.data_messages;
    messages += r.messages;
  }
  const lanes = [...byLane.values()]
    .sort((a, b) => b.messages - a.messages || b.usd - a.usd || byName(`${a.src}>${a.dst}`, `${b.src}>${b.dst}`))
    .slice(0, PROJECT_LANES)
    .map((l) => ({ ...l, usd: cents(l.usd) }));
  return { lanes, split: { data_messages: data, token_messages: messages - data } };
}

/** The label file's addresses on chains CCIP knows, then those a spread label credited over the month, busiest chain first. */
function addressesOf(
  entry: RegistryEntry,
  month: IdentityTotals | undefined,
  selectorOf: ReadonlyMap<string, string>,
  identityOfKey: (key: string) => SenderIdentity,
): Project['addresses'] {
  const listed = entry.addresses.flatMap((a) => {
    const chain = selectorOf.get(a.chain);
    return chain === undefined ? [] : [{ chain, address: a.address, note: a.note, inferred: false }];
  });
  const known = new Set(listed.map((a) => `${a.chain}:${a.address}`));
  const inferred = (month?.chains ?? []).flatMap((chain) =>
    (month?.keys ?? [])
      .filter((key) => key.startsWith(`${chain}:`) && !known.has(key) && identityOfKey(key).inferred)
      .map((key) => ({ chain, address: senderKeyAddress(key), note: null, inferred: true })),
  );
  return [...listed, ...inferred];
}
