import type { ReserveFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { reservePageSvg, reservePageTree } from '../worker/cards/reserve-page-card';
import { RESERVE, texts } from './fixtures/broadcast';

/** The Reserve as reserve.json had it on Oct 31, 2026: 65 weekly deposits in a row, the next due Nov 5. */
const HELD: ReserveFile = {
  ...RESERVE,
  latest: { ts: '2026-10-31T18:00:00.000Z', link: 6_475_076 },
  link_price_usd: 11.87,
  cost_basis: {
    link_in: 6_480_000, link_out: 4_924, cost_usd: 72_284_812, value_usd: 76_888_240, change_usd: 4_603_428, change_pct: 6.37, avg_deposit_price_usd: 11.16, unpriced_transfers: 0,
  },
  pace: {
    deposits: 65,
    last_deposit: { ts: '2026-10-29T15:37:00.000Z', tx: '0x09', link: 92_789, price_usd: 11.8, usd: 1_094_910 },
    days_since_last_deposit: 2,
    avg_weekly_link_4w: 83_697,
    avg_weekly_usd_4w: 987_624,
    annualized_link: 4_352_254,
    supply_share_pct: 0.647,
    next_milestone: { link: 7_000_000, eta: '2026-12-14T00:00:00.000Z' },
    avg_days_between_deposits: 7,
    next_expected_deposit: '2026-11-05T15:37:00.000Z',
    deposit_overdue: false,
    deposit_streak: 65,
  },
};

describe('the /reserve share card', () => {
  it('shows the LINK held, its value, the streak, the four stats and the page', () => {
    // #when
    const words = texts(reservePageTree(HELD)!).join('|');
    // #then
    expect(words).toContain('6,475,076');
    expect(words).toContain('65-WEEK DEPOSIT STREAK|LINK held · $76.9M at $11.87');
    expect(words).toContain('On its cost|+6.4%|A week|~83.7K|Of all LINK|0.65%|Deposit due|Nov 5');
    expect(words).toContain('ccip.dev/reserve');
  });

  it('labels the vault with how far it is to the next million, and the last million’s mark', () => {
    // #when
    const words = texts(reservePageTree(HELD)!).join('|');
    // #then
    expect(words).toContain('92.5%|OF 7,000,000|6M');
  });

  it('says the next deposit is due now once it is overdue', () => {
    // #given
    const overdue = { ...HELD, pace: { ...HELD.pace!, deposit_overdue: true } };
    // #when
    const words = texts(reservePageTree(overdue)!).join('|');
    // #then
    expect(words).toContain('Deposit due|Now');
  });

  it('draws the vault and a gold bar for each recent week with a deposit', () => {
    // #when
    const svg = reservePageSvg(HELD);
    // #then
    expect(svg.match(/<rect class="bar"/g)).toHaveLength(3);
  });

  it('still draws, without empty tiles, when there is no pace or cost basis yet', () => {
    // #given
    const bare = { ...HELD, pace: null, cost_basis: null };
    // #when
    const words = texts(reservePageTree(bare)!).join('|');
    const svg = reservePageSvg(bare);
    // #then
    expect([words, svg].join('|')).not.toMatch(/undefined|NaN|—|STREAK|Deposit due/);
  });

  it('leaves the page to the classic card until there is a balance', () => {
    // #then
    expect(reservePageTree({ ...RESERVE, latest: null })).toBeNull();
  });
});
