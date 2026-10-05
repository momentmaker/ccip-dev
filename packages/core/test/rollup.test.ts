import { describe, expect, it } from 'vitest';
import { median, rollupDay } from '../src/rollup';
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

describe('median', () => {
  it('returns null for no values, the middle for odd counts and the rounded mean for even counts', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});
