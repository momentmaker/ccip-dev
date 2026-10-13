import type { DayTotals, LargestFee, ReplayFile } from '@ccip-dev/core/public';

/**
 * About ten weeks of made-up CCIP activity, from 2026-07-25 to 2026-10-05, built so a month cut has something to show:
 * chains join in August, September and October; in September value crosses $1B (on 2026-09-15, which is also an
 * all-time busiest day) and total messages cross 10,000 (on 2026-09-19); fees start on 2026-08-01.
 */
export const FIRST_DAY = '2026-07-25';
export const LAST_DAY = '2026-10-05';
export const RECORD_DAY = '2026-09-15';
export const FEES_FROM = '2026-08-01';

export const CHAINS: ReplayFile['chains'] = [
  { selector: '5009297550715157269', name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', first_day: '2026-07-25' },
  { selector: '15971525489660198786', name: 'ethereum-mainnet-base-1', display_name: 'Base Mainnet', first_day: '2026-07-25' },
  { selector: '4949039107694359620', name: 'ethereum-mainnet-arbitrum-1', display_name: 'Arbitrum One', first_day: '2026-08-10' },
  { selector: '11344663589394136015', name: 'binance_smart_chain-mainnet', display_name: 'BNB Chain', first_day: '2026-09-03' },
  { selector: '7264351850409363825', name: 'ethereum-mainnet-mode-1', display_name: 'Mode', first_day: '2026-09-20' },
  { selector: '9478124434908827753', name: 'gravity-mainnet', display_name: 'Gravity', first_day: '2026-10-02' },
];

const LANES: [number, number][] = [[0, 1], [1, 0], [0, 2], [2, 1], [3, 0], [4, 3], [5, 0]];

function days(): string[] {
  const out: string[] = [];
  for (let ms = Date.parse(`${FIRST_DAY}T00:00:00Z`); ms <= Date.parse(`${LAST_DAY}T00:00:00Z`); ms += 86_400_000) out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}

const laneMessages = (k: number, lane: number, day: string) => (20 + ((k * 7 + lane * 13) % 17) * 3) * (day === RECORD_DAY ? 4 : 1);

export function monthsReplay(): ReplayFile {
  return {
    schema_version: 1,
    updated_at: '2026-10-06T00:07:00.000Z',
    attribution: 'Data: Chainlink CCIP API, DefiLlama',
    since: FIRST_DAY,
    chains: CHAINS.map((c) => ({ ...c })),
    lanes: LANES.map((l) => [l[0], l[1]] as [number, number]),
    days: days().map((day, k) => ({
      day,
      lanes: LANES.flatMap(([a, b], lane): [number, number, number][] => {
        if (CHAINS[a]!.first_day > day || CHAINS[b]!.first_day > day) return [];
        const messages = laneMessages(k, lane, day);
        return [[lane, messages, messages * 100_000 * (1 + lane / 10)]];
      }),
    })),
  };
}

export function monthsHistory(replay: ReplayFile = monthsReplay()): DayTotals[] {
  return replay.days.map((d) => {
    const messages = d.lanes.reduce((sum, [, m]) => sum + m, 0);
    const usd = d.lanes.reduce((sum, [, , u]) => sum + u, 0);
    const fee = d.day >= FEES_FROM ? messages / 2 : null;
    return {
      day: d.day,
      messages,
      token_messages: messages,
      usd_value: usd,
      fee_usd: fee,
      unique_senders: 10,
      median_delivery_s: 60,
      unpriced_messages: 0,
      fee_link_usd: fee === null ? null : fee * 0.4,
    };
  });
}

export const LARGEST_FEES: LargestFee[] = [
  { message_id: '0xaa', day: '2026-09-22', src: CHAINS[0]!.selector, dst: CHAINS[1]!.selector, fee_usd: 900, symbol: 'LINK' },
  { message_id: '0xbb', day: '2026-08-12', src: CHAINS[0]!.selector, dst: CHAINS[2]!.selector, fee_usd: 400, symbol: 'ETH' },
];
