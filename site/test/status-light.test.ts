import { describe, expect, it } from 'vitest';
import { ingestLagSeconds, statusLevel, statusText } from '../src/lib/status-light';

describe('status light', () => {
  it('measures lag from the last successful ingest', () => {
    const now = new Date('2026-10-07T12:00:00.000Z');
    expect(ingestLagSeconds({ last_ingest_ok_at: '2026-10-07T11:58:00.000Z' }, now)).toBe(120);
    expect(ingestLagSeconds({ last_ingest_ok_at: null }, now)).toBeNull();
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
});
