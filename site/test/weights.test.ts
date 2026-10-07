import type { ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { laneOpacity, lastReplayDay, skyScale, starRadius, topSelectors, trailingWeights, windowWeights } from '../src/sky/weights';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const ETH = '5009297550715157269';
const POLYGON = '4051577828743386545';
const BASE = '15971525489660198786';
const SOL = '124615329519749607';

describe('weights', () => {
  it('finds the last replay day', () => {
    expect(lastReplayDay(replay)).toBe('2023-07-09');
    expect(lastReplayDay({ days: [] })).toBeNull();
  });

  it('sums lane USD and messages over a window and credits both ends', () => {
    const w = windowWeights(replay, '2023-07-08', '2023-07-09');
    expect(w.lanes).toEqual([
      { src: ETH, dst: POLYGON, usd: 2000, messages: 10 },
      { src: ETH, dst: BASE, usd: 1_500_700, messages: 12 },
      { src: SOL, dst: ETH, usd: 300, messages: 1 },
    ]);
    expect(w.chains.get(ETH)).toBe(2000 + 1_500_700 + 300);
    expect(w.chains.get(POLYGON)).toBe(2000);
    expect(windowWeights(replay, null, '2023-07-06').lanes).toEqual([{ src: ETH, dst: POLYGON, usd: 0, messages: 2 }]);
  });

  it('takes trailing windows ending on the last replay day', () => {
    expect(trailingWeights(replay, 1).lanes.map((l) => l.messages)).toEqual([7, 1]);
  });

  it('sizes stars, fades lanes and picks the top selectors', () => {
    expect(starRadius(100, 100)).toBe(10);
    expect(starRadius(25, 100)).toBe(6);
    expect(starRadius(5, 0)).toBe(2);
    expect(laneOpacity(50, 50)).toBeCloseTo(0.56);
    expect(laneOpacity(0, 50)).toBeCloseTo(0.06);
    expect(laneOpacity(5, 0)).toBe(0.06);
    expect(topSelectors(new Map([['b', 5], ['a', 5], ['c', 9]]), 2)).toEqual(['c', 'a']);
  });
});

describe('skyScale', () => {
  it('scales stars by the shorter side over 700', () => {
    expect(skyScale(1400, 700)).toBe(1);
    expect(skyScale(390, 800)).toBeCloseTo(390 / 700, 10);
  });
});
