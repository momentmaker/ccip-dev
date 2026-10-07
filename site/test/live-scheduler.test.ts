import { describe, expect, it } from 'vitest';
import { LiveScheduler } from '../src/lib/live-scheduler';

const m = (id: string, ts: string) => ({ id, send_ts: `2026-10-07T00:${ts}.000Z` });
const ats = (planned: { at: number }[]) => planned.map((p) => p.at);
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('LiveScheduler', () => {
  it('animates only the last 2 minutes on first load, compressed into 10 s', () => {
    const s = new LiveScheduler();
    const out = s.ingest([m('a', '00:00'), m('b', '01:00'), m('c', '03:00'), m('d', '03:30')], 1000);
    expect(out.catchUp).toBe(true);
    expect(ids(out.comets.map((c) => c.message))).toEqual(['c', 'd']);
    expect(ats(out.comets)).toEqual([1000, 11_000]);
    expect(ids(out.feedOnly)).toEqual(['a', 'b']);
  });

  it('keeps real spacing within 30 s and compresses longer spans', () => {
    const s = new LiveScheduler();
    s.ingest([m('a', '00:00')], 0);
    expect(ats(s.ingest([m('a', '00:00'), m('b', '00:10'), m('c', '00:20')], 30_000).comets)).toEqual([30_000, 40_000]);
    expect(ats(s.ingest([m('b', '00:10'), m('c', '00:20'), m('d', '01:00'), m('e', '01:30'), m('f', '02:00')], 60_000).comets)).toEqual([60_000, 75_000, 90_000]);
  });

  it('never schedules a message twice', () => {
    const s = new LiveScheduler();
    s.ingest([m('a', '00:00'), m('b', '00:05')], 0);
    const again = s.ingest([m('a', '00:00'), m('b', '00:05')], 30_000);
    expect(again.comets).toEqual([]);
    expect(again.feedOnly).toEqual([]);
  });

  it('treats a poll after more than 60 s as a catch-up, as when the tab was hidden', () => {
    const s = new LiveScheduler();
    s.ingest([m('a', '00:00')], 0);
    const out = s.ingest([m('a', '00:00'), m('b', '01:00'), m('c', '05:00'), m('d', '06:00')], 200_000);
    expect(out.catchUp).toBe(true);
    expect(ids(out.comets.map((c) => c.message))).toEqual(['c', 'd']);
    expect(ats(out.comets)).toEqual([200_000, 210_000]);
    expect(ids(out.feedOnly)).toEqual(['b']);
  });

  it('only remembers ids still in the latest file', () => {
    const s = new LiveScheduler();
    s.ingest([m('a', '00:00')], 0);
    s.ingest([m('b', '00:10')], 30_000);
    expect(ids(s.ingest([m('a', '00:00'), m('b', '00:10')], 60_000).comets.map((c) => c.message))).toEqual(['a']);
  });

  it('returns nothing for an empty file', () => {
    expect(new LiveScheduler().ingest([], 0)).toEqual({ comets: [], feedOnly: [], catchUp: true });
  });
});
