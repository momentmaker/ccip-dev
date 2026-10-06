import { dayOf } from './time';
import { toUnits } from './value';

export const DEPOSIT_MIN_LINK = 1_000;
export const LINK_TOTAL_SUPPLY = 1_000_000_000;
export const MILESTONE_STEP_LINK = 1_000_000;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const AVERAGE_WEEKS = 4;

export interface PricedTransfer {
  ts: string;
  tx: string;
  direction: 'in' | 'out';
  counterparty: string;
  amount: string;
  linkUsd: number | null;
}

export interface TransferView {
  ts: string;
  tx: string;
  direction: 'in' | 'out';
  counterparty: string;
  link: number;
  price_usd: number | null;
  usd: number | null;
  value_now_usd: number | null;
  change_pct: number | null;
}

export interface WeekView {
  week: string;
  deposits: number;
  link: number;
  usd: number;
}

export interface ReserveStats {
  cost_basis: {
    link_in: number;
    link_out: number;
    cost_usd: number;
    value_usd: number | null;
    change_usd: number | null;
    change_pct: number | null;
    avg_deposit_price_usd: number | null;
    unpriced_transfers: number;
  };
  pace: {
    deposits: number;
    last_deposit: { ts: string; tx: string; link: number; price_usd: number | null; usd: number | null } | null;
    days_since_last_deposit: number | null;
    avg_weekly_link_4w: number | null;
    avg_weekly_usd_4w: number | null;
    annualized_link: number | null;
    supply_share_pct: number;
    next_milestone: { link: number; eta: string } | null;
  };
  weekly: WeekView[];
  performance: {
    best: { ts: string; tx: string; price_usd: number } | null;
    worst: { ts: string; tx: string; price_usd: number } | null;
    above: number | null;
    below: number | null;
  };
  transfers: TransferView[];
  latest_transfer: TransferView | null;
}

interface Row extends PricedTransfer {
  link: number;
  usd: number | null;
}

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const roundOrNull = (value: number | null, digits: number) => (value === null ? null : round(value, digits));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mondayMs = (iso: string) => Date.parse(`${weekStart(iso)}T00:00:00.000Z`);

export function weekStart(iso: string): string {
  const midnight = Date.parse(`${dayOf(iso)}T00:00:00.000Z`);
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  return dayOf(new Date(midnight - sinceMonday * DAY_MS));
}

function weeks(deposits: Row[], now: Date): WeekView[] {
  if (deposits.length === 0) return [];
  const series: WeekView[] = [];
  const byWeek = new Map<string, WeekView>();
  for (let ms = mondayMs(deposits[0]!.ts); ms <= mondayMs(now.toISOString()); ms += WEEK_MS) {
    const week = { week: dayOf(new Date(ms)), deposits: 0, link: 0, usd: 0 };
    series.push(week);
    byWeek.set(week.week, week);
  }
  for (const d of deposits) {
    const week = byWeek.get(weekStart(d.ts));
    if (!week) continue;
    week.deposits += 1;
    week.link += d.link;
    week.usd += d.usd ?? 0;
  }
  return series;
}

export function reserveStats(input: { transfers: PricedTransfer[]; linkPriceUsd: number | null; now: Date }): ReserveStats {
  const { linkPriceUsd, now } = input;
  const rows: Row[] = [...input.transfers]
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((t) => {
      const link = toUnits(t.amount, 18);
      return { ...t, link, usd: t.linkUsd === null ? null : link * t.linkUsd };
    });
  const inflows = rows.filter((r) => r.direction === 'in');
  const outflows = rows.filter((r) => r.direction === 'out');
  const deposits = inflows.filter((r) => r.link >= DEPOSIT_MIN_LINK);
  const pricedDeposits = deposits.filter((r) => r.linkUsd !== null);

  const linkIn = sum(inflows.map((r) => r.link));
  const linkOut = sum(outflows.map((r) => r.link));
  const net = linkIn - linkOut;
  const cost = sum(inflows.map((r) => r.usd ?? 0)) - sum(outflows.map((r) => r.usd ?? 0));
  const value = linkPriceUsd === null ? null : net * linkPriceUsd;
  const pricedNet = sum(inflows.filter((r) => r.linkUsd !== null).map((r) => r.link)) - sum(outflows.filter((r) => r.linkUsd !== null).map((r) => r.link));
  const change = linkPriceUsd === null ? null : pricedNet * linkPriceUsd - cost;
  const pricedDepositLink = sum(pricedDeposits.map((r) => r.link));

  const series = weeks(deposits, now);
  const complete = series.slice(0, -1).slice(-AVERAGE_WEEKS);
  const avgLink = complete.length === 0 ? null : sum(complete.map((w) => w.link)) / complete.length;
  const avgUsd = complete.length === 0 ? null : sum(complete.map((w) => w.usd)) / complete.length;
  const milestone = (Math.floor(net / MILESTONE_STEP_LINK) + 1) * MILESTONE_STEP_LINK;
  const last = deposits.at(-1);

  const byPrice = [...pricedDeposits].sort((a, b) => a.linkUsd! - b.linkUsd!);
  const entry = (r: Row | undefined) => (r === undefined ? null : { ts: r.ts, tx: r.tx, price_usd: round(r.linkUsd!, 4) });

  const view = (r: Row): TransferView => ({
    ts: r.ts,
    tx: r.tx,
    direction: r.direction,
    counterparty: r.counterparty,
    link: round(r.link, 2),
    price_usd: roundOrNull(r.linkUsd, 4),
    usd: roundOrNull(r.usd, 2),
    value_now_usd: r.direction === 'in' && linkPriceUsd !== null ? round(r.link * linkPriceUsd, 2) : null,
    change_pct:
      r.direction === 'in' && linkPriceUsd !== null && r.linkUsd !== null && r.linkUsd > 0
        ? round((linkPriceUsd / r.linkUsd - 1) * 100, 2)
        : null,
  });
  const transfers = rows.map(view);

  return {
    cost_basis: {
      link_in: round(linkIn, 2),
      link_out: round(linkOut, 2),
      cost_usd: round(cost, 2),
      value_usd: roundOrNull(value, 2),
      change_usd: roundOrNull(change, 2),
      change_pct: change === null || cost <= 0 ? null : round((change / cost) * 100, 2),
      avg_deposit_price_usd: pricedDepositLink === 0 ? null : round(sum(pricedDeposits.map((r) => r.usd!)) / pricedDepositLink, 4),
      unpriced_transfers: rows.filter((r) => r.linkUsd === null).length,
    },
    pace: {
      deposits: deposits.length,
      last_deposit: last
        ? { ts: last.ts, tx: last.tx, link: round(last.link, 2), price_usd: roundOrNull(last.linkUsd, 4), usd: roundOrNull(last.usd, 2) }
        : null,
      days_since_last_deposit: last ? round((now.getTime() - Date.parse(last.ts)) / DAY_MS, 2) : null,
      avg_weekly_link_4w: roundOrNull(avgLink, 2),
      avg_weekly_usd_4w: roundOrNull(avgUsd, 2),
      annualized_link: avgLink === null ? null : round(avgLink * 52, 2),
      supply_share_pct: round((net / LINK_TOTAL_SUPPLY) * 100, 4),
      next_milestone:
        avgLink === null || avgLink <= 0
          ? null
          : { link: milestone, eta: dayOf(new Date(now.getTime() + ((milestone - net) / avgLink) * WEEK_MS)) },
    },
    weekly: series.map((w) => ({ ...w, link: round(w.link, 2), usd: round(w.usd, 2) })),
    performance: {
      best: entry(byPrice[0]),
      worst: entry(byPrice.at(-1)),
      above: linkPriceUsd === null ? null : pricedDeposits.filter((r) => r.linkUsd! < linkPriceUsd).length,
      below: linkPriceUsd === null ? null : pricedDeposits.filter((r) => r.linkUsd! > linkPriceUsd).length,
    },
    transfers,
    latest_transfer: transfers.at(-1) ?? null,
  };
}
