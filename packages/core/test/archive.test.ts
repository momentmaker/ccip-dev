import { describe, expect, it } from 'vitest';
import { archiveKey, dedupeRawById, gunzipText, gzipText, toJsonl } from '../src/archive';

describe('archive helpers', () => {
  it('builds the per-day archive key', () => {
    expect(archiveKey('2026-10-05')).toBe('messages/2026/10/05.jsonl.gz');
  });

  it('keeps one entry per messageId (the last seen) in first-seen order', () => {
    const raws = [{ messageId: 'a', v: 1 }, { messageId: 'b', v: 1 }, { messageId: 'a', v: 2 }];
    expect(dedupeRawById(raws)).toEqual([{ messageId: 'a', v: 2 }, { messageId: 'b', v: 1 }]);
  });

  it('writes JSON lines and round-trips through gzip', async () => {
    const text = toJsonl([{ a: 1 }, { b: 2 }]);
    expect(text).toBe('{"a":1}\n{"b":2}\n');
    expect(await gunzipText(await gzipText(text))).toBe(text);
    expect(toJsonl([])).toBe('');
  });
});
