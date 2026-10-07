import { describe, expect, it } from 'vitest';
import { countUpValue, easeOutCubic } from '../src/components/hooks';

describe('count-up helpers', () => {
  it('eases out and clamps', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(3)).toBe(1);
  });

  it('interpolates from the old value to the new one', () => {
    expect(countUpValue(0, 1000, 0, 900)).toBe(0);
    expect(countUpValue(100, 200, 450, 900)).toBeCloseTo(187.5);
    expect(countUpValue(0, 1000, 2000, 900)).toBe(1000);
  });
});
