import { describe, expect, it } from 'vitest';
import { PUBLIC_SCHEMAS, ReplayFileSchema, ReserveFileSchema, StatusFileSchema, type PublicFileName } from '../src/public';
import chains from './fixtures/public/chains.json';
import history from './fixtures/public/history.json';
import live from './fixtures/public/live.json';
import reserve from './fixtures/public/reserve.json';
import status from './fixtures/public/status.json';
import today from './fixtures/public/today.json';
import tokens from './fixtures/public/tokens.json';
import topLane from './fixtures/public/top-lane.json';
import topSender from './fixtures/public/top-sender.json';
import topToken from './fixtures/public/top-token.json';

const CAPTURED: [PublicFileName, unknown][] = [
  ['status.json', status],
  ['live.json', live],
  ['today.json', today],
  ['history.json', history],
  ['top/lane.json', topLane],
  ['top/token.json', topToken],
  ['top/sender.json', topSender],
  ['chains.json', chains],
  ['tokens.json', tokens],
  ['reserve.json', reserve],
];

const envelope = { schema_version: 1, updated_at: '2026-10-07T00:00:00.000Z', attribution: 'Data: Chainlink CCIP API, DefiLlama' };
const emptyStatus = { ...envelope, last_ingest_ok_at: null, lag_seconds: null, last_finalize_day: null, coverage_from: null };

describe('public file schemas', () => {
  it.each(CAPTURED)('parse the captured production %s', (name, body) => {
    expect(PUBLIC_SCHEMAS[name].safeParse(body).error?.issues ?? []).toEqual([]);
  });

  it('ignore fields they do not know', () => {
    expect(StatusFileSchema.parse({ ...emptyStatus, brand_new: 1 })).not.toHaveProperty('brand_new');
  });

  it('reject a file missing a required field', () => {
    const { lag_seconds: _dropped, ...rest } = emptyStatus;
    expect(StatusFileSchema.safeParse(rest).success).toBe(false);
  });

  it('accept reserve.json before the scan has caught up', () => {
    const doc = {
      ...envelope, token: '0xlink', reserve: '0xreserve', latest: null, series: [], link_price_usd: null,
      cost_basis: null, pace: null, weekly: [], performance: null, transfers: [], latest_transfer: null,
    };
    expect(ReserveFileSchema.safeParse(doc).success).toBe(true);
  });

  it('parse replay.json chain, lane and day tuples', () => {
    const doc = {
      ...envelope,
      since: '2023-07-06',
      chains: [
        { selector: '1', name: 'a-mainnet', display_name: 'A Mainnet', first_day: '2023-07-06' },
        { selector: '2', name: null, display_name: null, first_day: '2023-07-06' },
      ],
      lanes: [[0, 1]],
      days: [{ day: '2023-07-06', lanes: [[0, 2, 0]] }],
    };
    expect(ReplayFileSchema.parse(doc).days[0]!.lanes).toEqual([[0, 2, 0]]);
  });

  it('reject a replay lane row with the wrong number of fields', () => {
    const doc = { ...envelope, since: null, chains: [], lanes: [], days: [{ day: '2023-07-06', lanes: [[0, 2]] }] };
    expect(ReplayFileSchema.safeParse(doc).success).toBe(false);
  });
});
