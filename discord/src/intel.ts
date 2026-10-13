import type { DossierCard, IntelChain, RecordMedal, RecordsCard, SitrepCard, VaultCard } from '@ccip-dev/core/linkmarine';
import { chainName, chainNameMap, shortChainName, type ChainNames } from '@ccip-dev/core/names';
import type { ChainsFile, HistoryFile, ReplayFile, ReserveFile, TodayFile, TopFile } from '@ccip-dev/core/public';
import { RECORD_KINDS, recordValue } from '@ccip-dev/core/records';
import { addDays, dayOf, weekStart } from '@ccip-dev/core/time';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const named = (names: ChainNames, selector: string): IntelChain => ({ selector, name: chainName(names, selector) });

/** /cciptoday from today.json, with yesterday's total from history.json when its last day is yesterday and had messages. */
export function sitrepCard(today: TodayFile, history: HistoryFile, chains: ChainsFile): SitrepCard {
  const names = chainNameMap(chains.chains);
  const elapsed = Date.parse(today.updated_at) - Date.parse(`${today.day}T00:00:00.000Z`);
  const last = history.days.at(-1);
  const yesterday = last && last.day === addDays(today.day, -1) && last.messages > 0 ? last.messages : null;
  const t = today.totals;
  return {
    updatedAt: today.updated_at,
    messages: t.messages,
    // An update just past midnight can still carry the day before: the whole of that day has gone, never more.
    pace: elapsed < HOUR_MS ? null : { projected: t.messages / Math.min(1, elapsed / DAY_MS), yesterday },
    usd: t.usd_value,
    feesUsd: t.fee_usd,
    linkSharePct: t.fee_link_share_pct,
    senders: t.unique_senders,
    medianDeliveryS: t.median_delivery_s,
    lanes: today.top.lane
      .filter((l) => (l.usd ?? 0) > 0)
      .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
      .slice(0, 5)
      .flatMap((l) => {
        const [src, dst] = l.key.split('>');
        return src && dst ? [{ src: named(names, src), dst: named(names, dst), usd: l.usd ?? 0 }] : [];
      }),
  };
}

interface ChainTotals {
  messages: number;
  usd: number;
}

/** Each chain's messages and value over [from, to] of replay.json, counting both directions. */
export function chainTotals(replay: ReplayFile, from: string | null, to: string | null): Map<string, ChainTotals> {
  const totals = new Map<string, ChainTotals>();
  for (const d of replay.days) {
    if ((from !== null && d.day < from) || (to !== null && d.day > to)) continue;
    for (const [lane, messages, usd] of d.lanes) {
      const ends = replay.lanes[lane];
      if (!ends) continue;
      for (const end of ends) {
        const selector = replay.chains[end]?.selector;
        if (!selector) continue;
        const t = totals.get(selector) ?? { messages: 0, usd: 0 };
        t.messages += messages;
        t.usd += usd;
        totals.set(selector, t);
      }
    }
  }
  return totals;
}

/** A chain picked by its display name, its registry name or its selector, ignoring case and " Mainnet". */
export function findChain(chains: ChainsFile, query: string): ChainsFile['chains'][number] | null {
  const q = query.trim().toLowerCase().replace(/ mainnet$/, '');
  if (!q) return null;
  return chains.chains.find((c) => c.selector === q || c.name.toLowerCase() === q || shortChainName(c).toLowerCase() === q || (c.display_name ?? '').toLowerCase().replace(/ mainnet$/, '') === q) ?? null;
}

export const MAX_CHOICES = 25;

/** /ccipchain's autocomplete: chains whose name or registry name contains the typed text, at most 25; the value is the selector. */
export function chainChoices(chains: ChainsFile, typed: string): { name: string; value: string }[] {
  const q = typed.trim().toLowerCase();
  return chains.chains
    .filter((c) => !q || shortChainName(c).toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    .map((c) => ({ name: shortChainName(c), value: c.selector }))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    })
    .slice(0, MAX_CHOICES);
}

/**
 * /ccipchain from replay.json (all time and the last 7 finalized days), top/src_chain.json (fees) and chains.json (the
 * first message); null for a chain with no traffic in replay.json.
 */
export function dossierCard(selector: string, replay: ReplayFile, sources: TopFile, chains: ChainsFile): DossierCard | null {
  const names = chainNameMap([...replay.chains, ...chains.chains]);
  const allTime = chainTotals(replay, null, null);
  const mine = allTime.get(selector);
  const lastDay = replay.days.at(-1)?.day;
  if (!mine || !lastDay) return null;
  const weekFrom = addDays(lastDay, -6);
  const ranked = replay.chains.length;
  const rank = 1 + [...allTime.values()].filter((t) => t.usd > mine.usd).length;
  const fees = sources.by_fees;
  const feeIndex = (fees?.['7d'] ?? []).slice(0, 3).findIndex((e) => e.key === selector);
  const partners = new Map<string, number>();
  for (const d of replay.days) {
    if (d.day < weekFrom) continue;
    for (const [lane, , usd] of d.lanes) {
      const ends = replay.lanes[lane];
      if (!ends) continue;
      const [src, dst] = ends.map((e) => replay.chains[e]?.selector);
      if (!src || !dst || (src !== selector && dst !== selector)) continue;
      const other = src === selector ? dst : src;
      partners.set(other, (partners.get(other) ?? 0) + usd);
    }
  }
  const byDay = new Map(replay.days.map((d) => [d.day, d]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i)).map((day) => {
    let messages = 0;
    for (const [lane, count] of byDay.get(day)?.lanes ?? []) {
      const ends = replay.lanes[lane];
      if (ends?.some((e) => replay.chains[e]?.selector === selector)) messages += count;
    }
    return { day, messages };
  });
  const week = chainTotals(replay, weekFrom, lastDay).get(selector) ?? { messages: 0, usd: 0 };
  const firstSeen = chains.chains.find((c) => c.selector === selector)?.first_seen;
  const since = firstSeen ? dayOf(firstSeen) : (replay.chains.find((c) => c.selector === selector)?.first_day ?? null);
  return {
    asOf: replay.updated_at,
    chain: named(names, selector),
    rank,
    ranked,
    feeRank: feeIndex < 0 ? null : feeIndex + 1,
    messages: mine.messages,
    usd: mine.usd,
    feesUsd: fees?.all.find((e) => e.key === selector)?.fee_usd ?? null,
    week,
    days,
    partners: [...partners]
      .filter(([, usd]) => usd > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 4)
      .map(([s, usd]) => ({ chain: named(names, s), usd })),
    since,
  };
}

/** The last 26 weeks' deposits; the week in progress counts only once it has one. */
export function weeklyDeposits(reserve: ReserveFile): number[] {
  const last = reserve.weekly.at(-1);
  const weeks = last && last.deposits === 0 && last.week === weekStart(reserve.updated_at) ? reserve.weekly.slice(0, -1) : reserve.weekly;
  return weeks.slice(-26).map((w) => w.link);
}

/** /linkreserve from reserve.json; null while the Reserve has no balance yet. */
export function vaultCard(reserve: ReserveFile): VaultCard | null {
  if (!reserve.latest) return null;
  const pace = reserve.pace;
  const cost = reserve.cost_basis;
  return {
    asOf: reserve.updated_at,
    link: reserve.latest.link,
    valueUsd: cost?.value_usd ?? (reserve.link_price_usd === null ? null : reserve.latest.link * reserve.link_price_usd),
    priceUsd: reserve.link_price_usd,
    changePct: cost?.change_pct ?? null,
    costUsd: cost?.cost_usd ?? null,
    streak: pace?.deposit_streak ?? 0,
    avgWeeklyLink: pace?.avg_weekly_link_4w ?? null,
    lastDeposit: pace?.last_deposit ? { link: pace.last_deposit.link, day: dayOf(pace.last_deposit.ts) } : null,
    nextDue: pace?.next_expected_deposit ? dayOf(pace.next_expected_deposit) : null,
    overdue: pace?.deposit_overdue ?? false,
    weekly: weeklyDeposits(reserve),
    milestone: pace?.next_milestone ?? null,
  };
}

/** /cciprecords from history.json, by the Records page's rules; the newest is the record set on the latest day. */
export function recordsCard(history: HistoryFile, chains: ChainsFile): RecordsCard {
  const names = chainNameMap(chains.chains);
  const largest = history.largest_fees ?? [];
  const medals = RECORD_KINDS.flatMap((kind): RecordMedal[] => {
    const best = recordValue(kind, history.days, largest);
    if (!best) return [];
    const fee = kind === 'largest_fee' ? largest.find((f) => f.day === best.day && f.fee_usd === best.value) : undefined;
    return [{ kind, value: best.value, day: best.day, lane: fee ? { src: chainName(names, fee.src), dst: chainName(names, fee.dst) } : null }];
  });
  const newest = medals.reduce<RecordMedal | null>((n, m) => (n === null || m.day > n.day ? m : n), null);
  return {
    asOf: history.updated_at,
    medals,
    newest: newest?.kind ?? null,
    messages: history.days.reduce((s, d) => s + d.messages, 0),
    usd: history.days.reduce((s, d) => s + d.usd_value, 0),
    since: history.since,
  };
}
