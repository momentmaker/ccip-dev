import { describe, expect, it } from 'vitest';
import { dayOf } from '../src/time';
import { linkFeeMatcher, linkFeeKeys, linkFeeUsd, median, rollupDay } from '../src/rollup';
import type { MessageRow, TokenRow } from '../src/types';

function row(id: string, overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    message_id: id, day: '2026-10-05', send_ts: '2026-10-05T10:00:00.000Z', receipt_ts: null, status: 'SENT',
    src_chain: 'A', dst_chain: 'B', sender: '0xs1', receiver: null, origin: null, token_count: 0, usd_value: 0,
    unpriced: 0, fee_token: null, fee_amount: null, fee_usd: null, ready_for_manual_exec: 0,
    detail_fetched_at: null, next_check_at: null, source: 'live', ...overrides,
  };
}

const messages = [
  row('m1', { token_count: 1, usd_value: 100, fee_usd: 1, status: 'SUCCESS', receipt_ts: '2026-10-05T10:01:00.000Z' }),
  row('m2', { token_count: 1, usd_value: 50, unpriced: 1, status: 'SUCCESS', receipt_ts: '2026-10-05T10:03:00.000Z' }),
  row('m3', { src_chain: 'C', sender: '0xs2', fee_usd: 2 }),
  row('m3', { src_chain: 'C', sender: '0xs2', fee_usd: 2 }),
  row('x9', { day: '2026-10-04' }),
];
const tokens: TokenRow[] = [
  { message_id: 'm1', idx: 0, chain: 'A', token: '0xt', amount: '1', usd_value: 100 },
  { message_id: 'm2', idx: 0, chain: 'A', token: '0xt', amount: '1', usd_value: 50 },
  { message_id: 'x9', idx: 0, chain: 'A', token: '0xt', amount: '1', usd_value: 999 },
];

describe('rollupDay', () => {
  const { totals, breakdown } = rollupDay('2026-10-05', messages, tokens);

  it('totals one day, counting a message seen twice only once', () => {
    expect(totals).toEqual({
      day: '2026-10-05',
      messages: 3,
      token_messages: 2,
      usd_value: 150,
      fee_usd: 3,
      unique_senders: 2,
      median_delivery_s: 120,
      unpriced_messages: 1,
    });
  });

  it('breaks the day down by chain, lane, sender and token', () => {
    const get = (dim: string, key: string) => breakdown.find((b) => b.dim === dim && b.key === key);
    expect(get('src_chain', 'A')).toEqual({ day: '2026-10-05', dim: 'src_chain', key: 'A', messages: 2, usd_value: 150, fee_usd: 1 });
    expect(get('lane', 'C>B')).toMatchObject({ messages: 1, usd_value: 0, fee_usd: 2 });
    expect(get('sender', 'A:0xs1')).toMatchObject({ messages: 2, usd_value: 150 });
    expect(get('token', 'A:0xt')).toEqual({ day: '2026-10-05', dim: 'token', key: 'A:0xt', messages: 2, usd_value: 150, fee_usd: null });
    expect(breakdown.filter((b) => b.dim === 'dst_chain')).toHaveLength(1);
  });

  it('reports fee_usd as null when no message on the day has a fee', () => {
    expect(rollupDay('2026-10-05', [row('a')], []).totals.fee_usd).toBeNull();
  });
});

describe('rollupDay boundaries and senders', () => {
  it('counts the same address on two source chains as two unique senders', () => {
    const { totals } = rollupDay('2026-10-05', [
      row('a', { src_chain: 'A', sender: '0xsame' }),
      row('b', { src_chain: 'B', sender: '0xsame' }),
    ], []);
    expect(totals.unique_senders).toBe(2);
  });

  it('assigns the last millisecond to its day and midnight to the next day', () => {
    const lastMs = '2026-10-05T23:59:59.999Z';
    const midnight = '2026-10-06T00:00:00.000Z';
    const all = [
      row('late', { send_ts: lastMs, day: dayOf(lastMs) }),
      row('early', { send_ts: midnight, day: dayOf(midnight) }),
    ];
    expect(rollupDay('2026-10-05', all, []).totals.messages).toBe(1);
    expect(rollupDay('2026-10-06', all, []).totals.messages).toBe(1);
  });
});

describe('median', () => {
  it('returns null for no values, the middle for odd counts and the rounded mean for even counts', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe('linkFeeUsd', () => {
  const LINK_BASE = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196';
  const BASE = '15971525489660198786';
  const isLinkFee = linkFeeMatcher(new Set([`${BASE}:${LINK_BASE.toLowerCase()}`]));
  const row = (id: string, day: string, feeToken: string | null, feeUsd: number | null) =>
    ({ message_id: id, day, src_chain: BASE, fee_token: feeToken, fee_usd: feeUsd }) as MessageRow;

  it('sums the fees paid in LINK, matching a checksummed fee token', () => {
    const rows = [row('a', '2026-10-05', LINK_BASE, 2), row('b', '2026-10-05', '0x4200000000000000000000000000000000000006', 3), row('c', '2026-10-05', LINK_BASE, 0.5)];
    expect(linkFeeUsd(rows, '2026-10-05', isLinkFee)).toBe(2.5);
  });

  it('is 0 when fees exist but none were paid in LINK', () => {
    expect(linkFeeUsd([row('a', '2026-10-05', '0x4200000000000000000000000000000000000006', 3)], '2026-10-05', isLinkFee)).toBe(0);
  });

  it('is null when no message of the day has a fee', () => {
    expect(linkFeeUsd([row('a', '2026-10-05', null, null)], '2026-10-05', isLinkFee)).toBeNull();
  });

  it('ignores other days and counts a duplicated message once', () => {
    const rows = [row('a', '2026-10-05', LINK_BASE, 2), row('a', '2026-10-05', LINK_BASE, 2), row('z', '2026-10-04', LINK_BASE, 9)];
    expect(linkFeeUsd(rows, '2026-10-05', isLinkFee)).toBe(2);
  });
});

describe('linkFeeKeys', () => {
  const ethLink = { chain: '5009297550715157269', address: '0x514910771af9ca656af840dff83e8264ecf986ca', groupId: 'link-group' };
  const baseLink = { chain: '15971525489660198786', address: '0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196', groupId: 'link-group' };
  const baseWeth = { chain: '15971525489660198786', address: '0x4200000000000000000000000000000000000006', groupId: 'weth-group' };

  it("includes every registry token in Ethereum LINK's group", () => {
    // #given / #when
    const keys = linkFeeKeys([ethLink, baseLink, baseWeth]);

    // #then
    expect(keys.has(`${baseLink.chain}:${baseLink.address}`)).toBe(true);
  });

  it('leaves out tokens of other groups', () => {
    expect(linkFeeKeys([ethLink, baseLink, baseWeth]).has(`${baseWeth.chain}:${baseWeth.address}`)).toBe(false);
  });

  it('includes Ethereum LINK and the unlisted LINK fee tokens even with an empty registry', () => {
    const keys = linkFeeKeys([]);
    expect([keys.has('5009297550715157269:0x514910771af9ca656af840dff83e8264ecf986ca'), keys.has('4949039107694359620:0xf97f4df75117a78c1a5a0dbb814af92458539fb4')]).toEqual([true, true]);
  });
});
