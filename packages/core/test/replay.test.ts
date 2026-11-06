import { describe, expect, it } from 'vitest';
import { buildReplay, type ChainNames, type LaneDayRow } from '../src/replay';

const A = '5009297550715157269';
const B = '15971525489660198786';
const C = '124615329519749607';
const names = new Map<string, ChainNames>([[A, { name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet' }]]);
const row = (day: string, key: string, messages: number, usd_value: number): LaneDayRow => ({ day, key, messages, usd_value });

describe('buildReplay', () => {
  it('orders chains by first day, then selector as a string, and names unknown chains null', () => {
    const replay = buildReplay([row('2023-07-07', `${C}>${A}`, 1, 1), row('2023-07-06', `${A}>${B}`, 2, 0)], names);
    expect(replay.chains).toEqual([
      { selector: B, name: null, display_name: null, first_day: '2023-07-06' },
      { selector: A, name: 'ethereum-mainnet', display_name: 'Ethereum Mainnet', first_day: '2023-07-06' },
      { selector: C, name: null, display_name: null, first_day: '2023-07-07' },
    ]);
  });

  it('indexes lanes by first appearance and writes ascending days with rounded USD', () => {
    const replay = buildReplay(
      [row('2023-07-07', `${A}>${B}`, 3, 10.6), row('2023-07-06', `${A}>${B}`, 2, 0.4), row('2023-07-07', `${B}>${A}`, 1, 5)],
      names,
    );
    expect(replay.lanes).toEqual([[1, 0], [0, 1]]);
    expect(replay.days).toEqual([
      { day: '2023-07-06', lanes: [[0, 2, 0]] },
      { day: '2023-07-07', lanes: [[0, 3, 11], [1, 1, 5]] },
    ]);
  });

  it('skips rows whose key is not a lane', () => {
    expect(buildReplay([row('2023-07-06', 'not-a-lane', 1, 1), row('2023-07-06', `${A}>`, 1, 1)], names)).toEqual({
      chains: [],
      lanes: [],
      days: [],
    });
  });
});

describe('buildReplay with CRE lanes', () => {
  const laneRows = [
    { day: '2026-11-01', key: 'a>b', messages: 10, usd_value: 100.4 },
    { day: '2026-11-01', key: 'a>c', messages: 4, usd_value: 0 },
    { day: '2026-11-02', key: 'a>b', messages: 6, usd_value: 50 },
  ];
  const noNames = new Map<string, ChainNames>();

  it('lists CRE lane-days by lane index, sorted, rounded', () => {
    // #when
    const r = buildReplay(laneRows, noNames, [
      { day: '2026-11-02', key: 'a>b', messages: 2, usd_value: 9.6 },
      { day: '2026-11-01', key: 'a>c', messages: 1, usd_value: 0 },
      { day: '2026-11-01', key: 'a>b', messages: 3, usd_value: 30.2 },
    ]);
    // #then lane 0 is a>b, lane 1 is a>c
    expect(r.cre).toEqual([
      { day: '2026-11-01', lanes: [[0, 3, 30], [1, 1, 0]] },
      { day: '2026-11-02', lanes: [[0, 2, 10]] },
    ]);
  });

  it('skips a CRE lane that has no lane row and never throws', () => {
    // #then
    expect(buildReplay(laneRows, noNames, [{ day: '2026-11-01', key: 'x>y', messages: 1, usd_value: 0 }]).cre).toBeUndefined();
  });

  it('omits cre without CRE rows, so the file is as before', () => {
    // #then
    expect('cre' in buildReplay(laneRows, noNames)).toBe(false);
  });
});
