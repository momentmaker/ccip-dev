import { describe, expect, it } from 'vitest';
import { niceTicks, pulseGeometry, pulseIndex } from '../src/lib/pulse';

const frame = { width: 100, height: 60, left: 0, right: 0, top: 0, bottom: 10 };
const day = (d: string, messages: number, fee_usd: number | null = 1) => ({ day: d, messages, usd_value: messages * 10, fee_usd });

describe('niceTicks', () => {
  it('steps in round numbers from zero past the max', () => {
    expect(niceTicks(5_027)).toEqual([0, 2_000, 4_000, 6_000]);
    expect(niceTicks(1_000)).toEqual([0, 250, 500, 750, 1_000]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe('pulseGeometry', () => {
  it('draws the days, marks the high and puts today after them', () => {
    const g = pulseGeometry([day('a', 100), day('b', 400), day('c', 200)], 'messages', { value: 150, paced: 300 }, frame);
    expect(g.xs.map((x) => Math.round(x))).toEqual([0, 33, 67, 100]);
    expect(g.high).toMatchObject({ index: 1, value: 400 });
    expect(g.today).toMatchObject({ x: 100, value: 150, paced: { value: 300 } });
    expect(g.line.startsWith('M0.0,')).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
  });

  it('raises the axis to fit where today is heading', () => {
    const g = pulseGeometry([day('a', 100)], 'messages', { value: 50, paced: 900 }, frame);
    expect(g.max).toBe(1_000);
    expect(g.today!.paced!.y).toBeCloseTo(5, 9);
  });

  it('leaves out days without a value, as fees before fee data', () => {
    const g = pulseGeometry([day('a', 1, null), day('b', 1, 8)], 'fee_usd', null, frame);
    expect(g.ys[0]).toBeNull();
    expect(g.line.match(/[ML]/g)).toHaveLength(1);
    expect(g.today).toBeNull();
  });
});

describe('pulseIndex', () => {
  it('finds the nearest slot', () => {
    expect(pulseIndex(40, [0, 33, 66, 100])).toBe(1);
    expect(pulseIndex(99, [0, 33, 66, 100])).toBe(3);
  });
});
