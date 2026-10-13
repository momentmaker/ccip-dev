import type { ChainsFile, HistoryFile, ReplayFile, ReserveFile, TodayFile, TopFile } from '@ccip-dev/core/public';

// Small public files for the intel math. today.json and reserve.json are trimmed from data.ccip.dev on Tue 13 Oct 2026;
// history.json, replay.json and top/src_chain.json are made up, small enough to check by hand.

export const ETH = '5009297550715157269';
export const BASE = '15971525489660198786';
export const ARB = '4949039107694359620';
export const MONAD = '8481857512324358265';
export const AVAX = '6433500567565415381';
export const PLASMA = '9335212494177455608';
export const WEMIX = '5142893604156789321';

const envelope = { schema_version: 1 as const, attribution: 'Data: Chainlink CCIP API, DefiLlama' };

export const CHAINS: ChainsFile = {
  ...envelope,
  updated_at: '2026-10-13T06:01:00.177Z',
  chains: [
    { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', family: 'EVM', chain_id: '1', first_seen: '2023-07-06T22:34:59.000Z' },
    { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet', family: 'EVM', chain_id: '8453', first_seen: '2023-09-16T23:37:29.000Z' },
    { selector: ARB, name: 'ethereum-mainnet-arbitrum-1', display_name: 'Arbitrum Mainnet', family: 'EVM', chain_id: '42161', first_seen: '2023-09-17T00:15:47.000Z' },
    { selector: MONAD, name: 'monad-mainnet', display_name: 'Monad Mainnet', family: 'EVM', chain_id: '143', first_seen: '2025-08-28T17:38:54.000Z' },
    { selector: AVAX, name: 'avalanche-mainnet', display_name: 'Avalanche Mainnet', family: 'EVM', chain_id: '43114', first_seen: '2023-07-07T00:06:34.000Z' },
    { selector: PLASMA, name: 'plasma-mainnet', display_name: 'Plasma Mainnet', family: 'EVM', chain_id: '9745', first_seen: '2025-09-25T12:00:00.000Z' },
    { selector: WEMIX, name: 'wemix-mainnet', display_name: 'WEMIX Mainnet', family: 'EVM', chain_id: '1111', first_seen: '2023-11-20T00:00:00.000Z' },
  ],
};

export const TODAY: TodayFile = {
  ...envelope,
  updated_at: '2026-10-13T11:28:01.860Z',
  day: '2026-10-13',
  totals: { day: '2026-10-13', messages: 685, token_messages: 439, usd_value: 44064348.04, fee_usd: 419.36, unique_senders: 211, median_delivery_s: 820, unpriced_messages: 15, fee_link_usd: 1.04, fee_link_share_pct: 0.25 },
  top: {
    lane: [
      { key: '8481857512324358265>5009297550715157269', messages: 9, usd: 16298903.16 },
      { key: '5009297550715157269>8481857512324358265', messages: 22, usd: 10704140.65 },
      { key: '5009297550715157269>9335212494177455608', messages: 6, usd: 6754321.91 },
      { key: '8481857512324358265>6433500567565415381', messages: 5, usd: 1999585.26 },
      { key: '8481857512324358265>9335212494177455608', messages: 3, usd: 1468701.01 },
      { key: '5009297550715157269>6433500567565415381', messages: 9, usd: 1332827.23 },
      { key: `${AVAX}>${ETH}`, messages: 40, usd: null },
    ],
    token: [],
    sender: [],
  },
  arrivals: [],
};

/**
 * Records: the busiest day 2026-02-22, the biggest 2026-04-20, the most fees 2026-07-09 (the newest), the largest fee
 * 2025-08-19 and the highest LINK share 2023-07-08 (2023-07-06's 100% is on fewer than 100 messages).
 */
export const HISTORY: HistoryFile = {
  ...envelope,
  updated_at: '2026-10-13T06:01:00.177Z',
  since: '2023-07-06',
  days: [
    { day: '2023-07-06', messages: 50, token_messages: 0, usd_value: 1_000_000, fee_usd: 100, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 100 },
    { day: '2023-07-08', messages: 120, token_messages: 0, usd_value: 2_000_000, fee_usd: 200, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 200 },
    { day: '2026-02-22', messages: 47414, token_messages: 0, usd_value: 50_000_000, fee_usd: 10_000, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 100 },
    { day: '2026-04-20', messages: 3000, token_messages: 0, usd_value: 330_226_186.84, fee_usd: 20_000, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 50 },
    { day: '2026-07-09', messages: 2500, token_messages: 0, usd_value: 40_000_000, fee_usd: 57_347.81, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 10 },
    { day: '2026-10-11', messages: 1500, token_messages: 0, usd_value: 30_000_000, fee_usd: 400, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 1 },
    { day: '2026-10-12', messages: 1625, token_messages: 0, usd_value: 35_000_000, fee_usd: 420, unique_senders: 10, median_delivery_s: 600, unpriced_messages: 0, fee_link_usd: 1 },
  ],
  largest_fees: [
    { message_id: '0x3265', day: '2025-08-19', src: WEMIX, dst: ETH, fee_usd: 9002.29, symbol: 'WWEMIX' },
    { message_id: '0x0059', day: '2025-10-10', src: ARB, dst: ETH, fee_usd: 1660.73, symbol: null },
  ],
};

/**
 * Lanes 0 ETH→Base, 1 Base→ETH, 2 Base→Monad, 3 Avalanche→Base, 4 ETH→Arbitrum, 5 Monad→ETH. All time, by value both
 * ways: Ethereum $44M, Arbitrum $29M, Base $12.9M (225 messages), Monad $5.5M, Avalanche $0.4M. Base's last 7 days
 * (Oct 6–12): 115 messages, $10.9M, with Ethereum $9M, Monad $1.5M and Avalanche $0.4M.
 */
export const REPLAY: ReplayFile = {
  ...envelope,
  updated_at: '2026-10-13T06:01:00.177Z',
  since: '2023-07-06',
  chains: [
    { selector: ETH, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', first_day: '2023-07-06' },
    { selector: BASE, name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet', first_day: '2023-09-16' },
    { selector: ARB, name: 'ethereum-mainnet-arbitrum-1', display_name: 'Arbitrum Mainnet', first_day: '2023-09-17' },
    { selector: MONAD, name: 'monad-mainnet', display_name: 'Monad Mainnet', first_day: '2025-08-28' },
    { selector: AVAX, name: 'avalanche-mainnet', display_name: 'Avalanche Mainnet', first_day: '2023-07-07' },
  ],
  lanes: [[0, 1], [1, 0], [1, 3], [4, 1], [0, 2], [3, 0]],
  days: [
    { day: '2023-09-16', lanes: [[0, 10, 1_000_000]] },
    { day: '2026-10-05', lanes: [[0, 100, 1_000_000], [4, 50, 9_000_000]] },
    { day: '2026-10-06', lanes: [[1, 20, 2_000_000], [2, 5, 500_000]] },
    { day: '2026-10-07', lanes: [[3, 7, 300_000]] },
    { day: '2026-10-08', lanes: [[5, 40, 4_000_000]] },
    { day: '2026-10-09', lanes: [[0, 30, 3_000_000]] },
    { day: '2026-10-10', lanes: [[2, 10, 1_000_000], [4, 60, 20_000_000]] },
    { day: '2026-10-11', lanes: [[1, 15, 1_500_000]] },
    { day: '2026-10-12', lanes: [[0, 25, 2_500_000], [3, 3, 100_000]] },
  ],
};

const top = (key: string, fee_usd: number) => ({ key, messages: 1, usd: 1, fee_usd });

export const SOURCES: TopFile = {
  ...envelope,
  updated_at: '2026-10-13T06:01:00.177Z',
  dim: 'src_chain',
  since: '2023-07-06',
  windows: { '7d': [], '30d': [], all: [] },
  by_fees: { '7d': [top(BASE, 1851.08), top('11344663589394136015', 1512.25), top(ETH, 1140.98), top(ARB, 900)], '30d': [], all: [top(ETH, 163_207.21), top(BASE, 356_718.47)] },
};

export const RESERVE: ReserveFile = {
  ...envelope,
  updated_at: '2026-10-13T11:00:55.843Z',
  token: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  reserve: '0x9A709B7B69EA42D5eeb1ceBC48674C69E1569eC6',
  latest: { ts: '2026-10-13T11:00:44.659Z', link: 6204681.79 },
  series: [],
  link_price_usd: 12.8643,
  cost_basis: { link_in: 6204682.79, link_out: 1, cost_usd: 69008608.43, value_usd: 79818684, change_usd: 10810075.58, change_pct: 15.66, avg_deposit_price_usd: 11.122, unpriced_transfers: 0 },
  pace: {
    deposits: 62,
    last_deposit: { ts: '2026-10-08T15:36:47.000Z', tx: '0xf978d26d9def696258b041d104e9ac166e492ab81802e175a0f2d50fd76598a0', link: 82480.36, price_usd: 12.4924, usd: 1030379.07 },
    days_since_last_deposit: 4.81,
    avg_weekly_link_4w: 85687.03,
    avg_weekly_usd_4w: 1078271.45,
    annualized_link: 4455725.56,
    supply_share_pct: 0.6205,
    next_milestone: { link: 7000000, eta: '2026-12-17' },
    avg_days_between_deposits: 7,
    next_expected_deposit: '2026-10-15T15:36:59.000Z',
    deposit_overdue: false,
    deposit_streak: 62,
  },
  weekly: [
    { week: '2026-04-06', deposits: 1, link: 131656.27, usd: 1172652.11 },
    { week: '2026-04-13', deposits: 1, link: 121949.84, usd: 1137534.51 },
    { week: '2026-04-20', deposits: 1, link: 123521.9, usd: 1156529.48 },
    { week: '2026-04-27', deposits: 1, link: 125525.28, usd: 1144875.13 },
    { week: '2026-05-04', deposits: 1, link: 119241.2, usd: 1175155 },
    { week: '2026-05-11', deposits: 1, link: 100908.77, usd: 1061638.22 },
    { week: '2026-05-18', deposits: 1, link: 123777.33, usd: 1192049.02 },
    { week: '2026-05-25', deposits: 1, link: 132002.93, usd: 1169235.11 },
    { week: '2026-06-01', deposits: 1, link: 148258.62, usd: 1197950.81 },
    { week: '2026-06-08', deposits: 1, link: 147197.58, usd: 1140721.6 },
    { week: '2026-06-15', deposits: 1, link: 143676.39, usd: 1137817.56 },
    { week: '2026-06-22', deposits: 1, link: 153956.18, usd: 1101508.09 },
    { week: '2026-06-29', deposits: 1, link: 151674.71, usd: 1179840.59 },
    { week: '2026-07-06', deposits: 1, link: 146110.67, usd: 1127176.37 },
    { week: '2026-07-13', deposits: 1, link: 138306.29, usd: 1168318 },
    { week: '2026-07-20', deposits: 1, link: 135168.33, usd: 1143441.8 },
    { week: '2026-07-27', deposits: 1, link: 135549.02, usd: 1145461.24 },
    { week: '2026-08-03', deposits: 1, link: 139956.08, usd: 1154197.69 },
    { week: '2026-08-10', deposits: 1, link: 127744.15, usd: 1122018.86 },
    { week: '2026-08-17', deposits: 1, link: 103041.41, usd: 1098263.79 },
    { week: '2026-08-24', deposits: 1, link: 91988.7, usd: 1099980.76 },
    { week: '2026-08-31', deposits: 1, link: 97110.77, usd: 1136712.32 },
    { week: '2026-09-07', deposits: 1, link: 91115.63, usd: 1058721.92 },
    { week: '2026-09-14', deposits: 1, link: 97459.26, usd: 1103007.14 },
    { week: '2026-09-21', deposits: 1, link: 88105.46, usd: 1114699.47 },
    { week: '2026-09-28', deposits: 1, link: 74703.04, usd: 1065000.12 },
    { week: '2026-10-05', deposits: 1, link: 82480.36, usd: 1030379.07 },
    { week: '2026-10-12', deposits: 0, link: 0, usd: 0 },
  ],
  performance: null,
  transfers: [],
  latest_transfer: null,
};
