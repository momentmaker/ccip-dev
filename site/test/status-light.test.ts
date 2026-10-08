import { describe, expect, it } from 'vitest';
import { ingestLagSeconds, statusLevel, statusText, statusWord } from '../src/lib/status-light';

describe('status light', () => {
  it('measures lag from the last successful ingest', () => {
    const now = new Date('2026-10-07T12:00:00.000Z');
    expect(ingestLagSeconds({ last_ingest_ok_at: '2026-10-07T11:58:00.000Z' }, now)).toBe(120);
    expect(ingestLagSeconds({ last_ingest_ok_at: null }, now)).toBeNull();
  });

  it('turns a 599.5 s lag red, because it rounds to the 600 s line', () => {
    const now = new Date('2026-10-07T12:00:00.000Z');
    const lagAt = (ms: number) => ingestLagSeconds({ last_ingest_ok_at: new Date(now.getTime() - ms).toISOString() }, now)!;
    expect(statusLevel(lagAt(599_499), 0)).toBe('amber');
    expect(statusLevel(lagAt(599_500), 0)).toBe('red');
    expect(statusText(statusLevel(lagAt(600_000), 0), lagAt(600_000))).toBe('Stalled · 10m 0s behind');
  });

  it.each([
    [0, 0, 'green'],
    [119, 0, 'green'],
    [120, 0, 'amber'],
    [599, 0, 'amber'],
    [600, 0, 'red'],
    [null, 0, 'red'],
    [5, 2, 'green'],
    [5, 3, 'red'],
  ] as const)('lag %s with %s failed polls is %s', (lag, failures, level) => {
    expect(statusLevel(lag, failures)).toBe(level);
  });

  it('describes each level', () => {
    expect(statusText('green', 4)).toBe('Live · 4s behind');
    expect(statusText('amber', 300)).toBe('Delayed · 5m 0s behind');
    expect(statusText('red', 900)).toBe('Stalled · 15m 0s behind');
    expect(statusText('red', null)).toBe('Live data unavailable');
  });

  it.each([
    ['green', 0, 'Live'],
    ['amber', 0, 'Delayed'],
    ['red', 0, 'Stalled'],
    ['green', 1, 'Paused'],
    ['amber', 2, 'Paused'],
    [null, 0, 'Checking'],
    [null, 1, 'Paused'],
    ['red', 3, 'Stalled'],
  ] as const)('word for level %s with %s failures is %s', (level, failures, word) => {
    expect(statusWord(level, failures)).toBe(word);
  });
});
