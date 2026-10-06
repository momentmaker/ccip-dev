import { describe, expect, it } from 'vitest';
import { ListMessage } from '../src/ccip/schemas';
import { normalizeList } from '../src/normalize';
import { buildRows, firstCheckAt, isFinal, scheduleNextCheck, toMessageRow, toTokenRows } from '../src/rows';
import listPage from './fixtures/list-page.json';

const m = normalizeList(ListMessage.parse(listPage.data[0]));
const v = { usdValue: 48001.16, unpriced: false, tokenUsd: [48001.16], outliers: [] };

describe('row building', () => {
  it('builds a live message row', () => {
    expect(toMessageRow(m, v, { source: 'live', nextCheckAt: firstCheckAt(m.sendTs) })).toEqual({
      message_id: m.messageId,
      day: '2026-10-05',
      send_ts: '2026-10-05T11:14:53.000Z',
      receipt_ts: null,
      status: 'SENT',
      src_chain: '15971525489660198786',
      dst_chain: '11344663589394136015',
      sender: '0x7af7632562b6063e52788607ad56f7a60f57ce09',
      receiver: '0x346ec0fadbf97cc3a5e2fbdaa7e4d10503f1052e',
      origin: '0x9568a788e04b2e35383c284bf3d748483d77db44',
      token_count: 1,
      usd_value: 48001.16,
      unpriced: 0,
      fee_token: null,
      fee_amount: null,
      fee_usd: null,
      ready_for_manual_exec: 0,
      detail_fetched_at: null,
      next_check_at: '2026-10-05T11:16:53.000Z',
      source: 'live',
    });
  });

  it('builds token rows keyed by position', () => {
    expect(toTokenRows(m, v)).toEqual([
      {
        message_id: m.messageId,
        idx: 0,
        chain: '15971525489660198786',
        token: '0x9818b6c09f5ecc843060927e8587c427c7c93583',
        amount: '24000580226526875891506',
        usd_value: 48001.16,
      },
    ]);
  });

  it('values every message and returns aligned message and token rows', () => {
    const lookup = () => ({ price: 1, decimals: 18 });
    const { rows, tokens } = buildRows([m], lookup, () => ({ source: 'backfill' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ message_id: m.messageId, source: 'backfill', next_check_at: null, unpriced: 0 });
    expect(rows[0]!.usd_value).toBeCloseTo(24000.580226526876, 6);
    expect(tokens).toEqual([expect.objectContaining({ message_id: m.messageId, idx: 0 })]);
  });

  it('returns the outliers of every message, a token valued above MAX_TRANSFER_USD left unpriced', () => {
    const glitched = () => ({ price: 1e9, decimals: 18 });
    const { rows, tokens, outliers } = buildRows([m, { ...m, messageId: 'second' }], glitched, () => ({ source: 'backfill' }));
    expect([rows.map((r) => [r.usd_value, r.unpriced]), tokens.map((t) => t.usd_value), outliers]).toEqual([
      [[0, 1], [0, 1]],
      [null, null],
      [`base:${m.tokens[0]!.token}`, `base:${m.tokens[0]!.token}`],
    ]);
  });

  it('values tokens without a price of their own through the fallback', () => {
    const fallback = () => ({ price: 2, decimals: 18 });
    const { rows, tokens } = buildRows([m], () => undefined, () => ({ source: 'backfill' }), fallback);
    expect(rows[0]).toMatchObject({ unpriced: 0 });
    expect(rows[0]!.usd_value).toBeCloseTo(48001.16045305375, 6);
    expect(tokens[0]!.usd_value).toBeCloseTo(48001.16045305375, 6);
  });
});

describe('status scheduling', () => {
  const sendTs = '2026-10-05T00:00:00.000Z';
  const at = (hours: number) => new Date(Date.parse(sendTs) + hours * 3_600_000);

  it('treats SUCCESS, UNRESOLVED and non-executable FAILED as final', () => {
    expect([isFinal('SUCCESS', false), isFinal('UNRESOLVED', false), isFinal('FAILED', false), isFinal('FAILED', true)]).toEqual([
      true, true, true, false,
    ]);
    expect(scheduleNextCheck('SUCCESS', false, sendTs, at(1))).toEqual({ status: 'SUCCESS', nextCheckAt: null });
  });

  it('steps re-checks from 10 min to 1 h to 6 h by cumulative age', () => {
    expect(scheduleNextCheck('SENT', false, sendTs, at(0.1)).nextCheckAt).toBe(new Date(at(0.1).getTime() + 600_000).toISOString());
    expect(scheduleNextCheck('SENT', false, sendTs, at(0.5)).nextCheckAt).toBe(at(1.5).toISOString());
    expect(scheduleNextCheck('SENT', false, sendTs, at(2)).nextCheckAt).toBe(at(8).toISOString());
    expect(scheduleNextCheck('SENT', false, sendTs, at(10)).nextCheckAt).toBe(at(16).toISOString());
  });

  it('marks messages still pending after 48 hours as UNRESOLVED', () => {
    expect(scheduleNextCheck('SENT', false, sendTs, at(49))).toEqual({ status: 'UNRESOLVED', nextCheckAt: null });
  });

  it('keeps re-checking manually executable FAILED messages until 48 hours, then keeps FAILED', () => {
    expect(scheduleNextCheck('FAILED', true, sendTs, at(3)).nextCheckAt).toBe(at(9).toISOString());
    expect(scheduleNextCheck('FAILED', true, sendTs, at(49))).toEqual({ status: 'FAILED', nextCheckAt: null });
  });
});
