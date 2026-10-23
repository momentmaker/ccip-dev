import { PUBLIC_SCHEMAS, type ChainsFile, type DayLeadersFile, type HistoryFile, type PublicFile, type PublicFileName, type ReplayFile, type ReserveFile, type TopFile } from '@ccip-dev/core/public';

export const ETH = '5009297550715157269';
export const BASE = '15971525489660198786';
export const ARB = '4949039107694359620';
/** A quiet Saturday: fewer messages, value and fees than the days before, so it sets no record. */
export const DAY = '2026-10-10';
/** A record Sunday: the most messages, value and fees in a day, and the largest single fee. */
export const RECORD_DAY = '2026-10-11';
export const MONDAY = '2026-10-05';
export const SENDER = '0x7af7632562b6063e52788607ad56f7a60f57ce09';

const envelope = { schema_version: 1 as const, updated_at: '2026-10-12T00:07:00.000Z', attribution: 'Data: Chainlink CCIP API, DefiLlama' };
/** Sep 28 to Oct 11: two Monday–Sunday weeks. */
const DAYS = Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10));

const figures = (day: string) =>
  day === DAY
    ? { messages: 150, usd: 2e6, fee: 3, link: 0.75, amount: 0.29 }
    : day === RECORD_DAY
      ? { messages: 300, usd: 9e6, fee: 6, link: 1.5, amount: 0.12 }
      : { messages: 200, usd: 8e6, fee: 4, link: 1, amount: 0.08 };

export const HISTORY: HistoryFile = {
  ...envelope,
  since: '2023-07-06',
  days: DAYS.map((day) => {
    const f = figures(day);
    return { day, messages: f.messages, token_messages: 0, data_messages: Math.round(f.messages * 0.62), usd_value: f.usd, fee_usd: f.fee, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0, fee_link_usd: f.link, fee_link_amount: f.amount };
  }),
  largest_fees: [
    { message_id: '0x1', day: RECORD_DAY, src: ETH, dst: BASE, fee_usd: 120, symbol: 'LINK' },
    { message_id: '0x2', day: '2026-09-30', src: BASE, dst: ARB, fee_usd: 80, symbol: 'ETH' },
  ],
};

const leader = (key: string, label: string | null, messages: number, usd: number | null, fee: number | null) => ({ key, label, messages, usd, fee_usd: fee });
const dayLeaders = (day: string, feeLaneMessages: number) => ({
  day,
  token: leader(`${BASE}:0xtok`, 'syrupUSDC', 40, 500_000, null),
  sender: leader(`${ETH}:${SENDER}`, 'xStocks', 97, 300_000, 1),
  lane: leader(`${ETH}>${BASE}`, null, 30, 1_200_000, 1),
  fee_lane: leader(`${BASE}>${ARB}`, null, feeLaneMessages, 800_000, 2),
  fee_chain: leader(BASE, null, 60, 800_000, 2),
});

export const LEADERS: DayLeadersFile = {
  ...envelope,
  days: [dayLeaders(DAY, 60), dayLeaders(RECORD_DAY, 5_712)],
  weeks: [{ week: MONDAY, fee_chains: [leader(BASE, null, 1, 1, 1_800), leader(ETH, null, 1, 1, 1_600), leader(ARB, null, 1, 1, 1_000)] }],
};

export const REPLAY: ReplayFile = {
  ...envelope,
  since: '2023-07-06',
  chains: [
    { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', first_day: '2023-07-06' },
    { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet', first_day: '2023-11-03' },
    { selector: ARB, name: 'ethereum-mainnet-arbitrum-1', display_name: 'Arbitrum One', first_day: '2023-07-06' },
  ],
  lanes: [[0, 1], [1, 2]],
  days: DAYS.map((day) => ({ day, lanes: [[0, 30, 1_200_000], [1, 60, 800_000]] as [number, number, number][] })),
};

export const CHAINS: ChainsFile = {
  ...envelope,
  chains: REPLAY.chains.map((c) => ({ selector: c.selector, name: c.name!, display_name: c.display_name, family: 'EVM', chain_id: '1', first_seen: null })),
};

export const DEPOSIT_TX = `0x${'ab'.repeat(32)}`;
export const OUTFLOW_TX = `0x${'ef'.repeat(32)}`;

const transfer = (ts: string, tx: string, direction: 'in' | 'out', link: number, extra: Partial<ReserveFile['transfers'][number]> = {}) => ({
  ts, tx, direction, counterparty: '0x5680681ed3767b96914ce741a308155c7fb9171d', link, price_usd: null, usd: null, value_now_usd: null, change_pct: null,
  deposit: direction === 'in' && link >= 1000, ...extra,
});

/** Three weekly deposits; the last is the one broadcast. A 5-LINK gift and a 1-LINK outflow sit between them. */
export const RESERVE: ReserveFile = {
  ...envelope,
  token: '0x514910771af9ca656af840dff83e8264ecf986ca',
  reserve: '0x9a709b7b69ea42d5eeb1cebc48674c69e1569ec6',
  latest: null,
  series: [],
  link_price_usd: 15,
  cost_basis: null,
  pace: null,
  performance: null,
  latest_transfer: null,
  weekly: [
    { week: '2026-08-31', deposits: 1, link: 100_000, usd: 1_000_000 },
    { week: '2026-09-07', deposits: 1, link: 50_000, usd: 600_000 },
    { week: '2026-09-14', deposits: 1, link: 60_000, usd: 750_000 },
  ],
  transfers: [
    transfer('2026-09-01T10:00:00.000Z', '0x01', 'in', 100_000),
    transfer('2026-09-02T12:00:00.000Z', '0x02', 'in', 5),
    transfer('2026-09-08T15:00:00.000Z', '0x03', 'in', 50_000),
    transfer('2026-09-10T09:00:00.000Z', OUTFLOW_TX, 'out', 1),
    transfer('2026-09-15T15:00:00.000Z', DEPOSIT_TX, 'in', 60_000, { price_usd: 12.5, usd: 750_000, value_now_usd: 900_000, change_pct: 20 }),
  ],
};

/** The last 7 days' busiest lane by value, as top/lane.json publishes it. */
export const TOP_LANE: TopFile = {
  ...envelope,
  dim: 'lane',
  since: '2023-07-06',
  windows: { '7d': [{ key: `${ETH}>${BASE}`, messages: 210, usd: 8_400_000 }], '30d': [], all: [] },
};

export const BROADCAST_FILES: Record<string, unknown> = {
  'history.json': HISTORY,
  'day-leaders.json': LEADERS,
  'replay.json': REPLAY,
  'chains.json': CHAINS,
  'reserve.json': RESERVE,
  'top/lane.json': TOP_LANE,
};

export async function loadFixture<N extends PublicFileName>(name: N): Promise<PublicFile<N>> {
  if (!(name in BROADCAST_FILES)) throw new Error(`${name} is not a broadcast fixture`);
  return PUBLIC_SCHEMAS[name].parse(BROADCAST_FILES[name]) as PublicFile<N>;
}

/** Every text node of a card tree, in order. */
export function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (typeof node !== 'object' || node === null) return [];
  const children = (node as { props?: { children?: unknown } }).props?.children;
  return Array.isArray(children) ? children.flatMap(texts) : texts(children);
}
