import { describe, expect, it } from 'vitest';
import { changeTone } from '../src/lib/tone';

describe('changeTone', () => {
  it.each([
    [5, 'up'],
    [-5, 'down'],
    [0, 'flat'],
    [-0, 'flat'],
    [null, 'flat'],
    [undefined, 'flat'],
  ] as const)('%s is %s', (value, tone) => {
    expect(changeTone(value)).toBe(tone);
  });
});
