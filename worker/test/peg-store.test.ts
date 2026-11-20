import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import * as pegStore from '../src/peg-store';
import { resetStorage } from './helpers';

beforeEach(resetStorage);

const bar = (hour: string, close: number) => ({ hour, open: close, high: close, low: close, close });

describe('peg_hours', () => {
  it('upserts bars, a later read replacing an hour, and reads them in hour order', async () => {
    await pegStore.upsertPegHours(env.DB, [bar('2026-09-25T21:00:00.000Z', 1.04), bar('2026-09-25T20:00:00.000Z', 1.0254)]);
    await pegStore.upsertPegHours(env.DB, [bar('2026-09-25T21:00:00.000Z', 1.0415)]);
    expect(await pegStore.pegHours(env.DB)).toEqual([bar('2026-09-25T20:00:00.000Z', 1.0254), bar('2026-09-25T21:00:00.000Z', 1.0415)]);
  });

  it('takes no bars without a statement', async () => {
    await pegStore.upsertPegHours(env.DB, []);
    expect(await pegStore.pegHours(env.DB)).toEqual([]);
  });

  it('writes more bars than one statement binds', async () => {
    const many = Array.from({ length: 200 }, (_, i) => bar(new Date(Date.UTC(2026, 0, 1, i)).toISOString(), 1));
    await pegStore.upsertPegHours(env.DB, many);
    expect(await pegStore.pegHours(env.DB)).toHaveLength(200);
  });
});

describe('peg_episodes', () => {
  const OPEN = { side: 'discount' as const, openedAt: '2026-11-18T00:00:00.000Z', peakGap: -0.005, peakAt: '2026-11-18T00:05:00.000Z', tier: 0, public: false };

  it('inserts an open episode and finds it by the open index', async () => {
    const id = await pegStore.insertPegEpisode(env.DB, OPEN);
    expect(await pegStore.openPegEpisode(env.DB)).toEqual({
      id, side: 'discount', opened_at: OPEN.openedAt, closed_at: null, peak_gap: -0.005, peak_at: OPEN.peakAt, best_size: null, best_profit: null, tier: 0, public: 0, public_at: null,
    });
  });

  it('saves the peak, tier, public flag, best size and close', async () => {
    const id = await pegStore.insertPegEpisode(env.DB, OPEN);
    await pegStore.savePegEpisode(env.DB, id, { peak_gap: -0.009, peak_at: '2026-11-18T01:00:00.000Z', tier: 0, public: true, public_at: '2026-11-18T00:40:00.000Z', best_size: 25_000, best_profit: 61.5, closed_at: '2026-11-18T03:00:00.000Z' });
    expect(await pegStore.openPegEpisode(env.DB)).toBeNull();
    expect(await pegStore.recentPegEpisodes(env.DB, 10)).toEqual([
      { id, side: 'discount', opened_at: OPEN.openedAt, closed_at: '2026-11-18T03:00:00.000Z', peak_gap: -0.009, peak_at: '2026-11-18T01:00:00.000Z', best_size: 25_000, best_profit: 61.5, tier: 0, public: 1, public_at: '2026-11-18T00:40:00.000Z' },
    ]);
  });

  it('lists the newest episodes first, up to the limit', async () => {
    const a = await pegStore.insertPegEpisode(env.DB, OPEN);
    const b = await pegStore.insertPegEpisode(env.DB, { ...OPEN, side: 'premium' });
    expect((await pegStore.recentPegEpisodes(env.DB, 1)).map((r) => r.id)).toEqual([b]);
    expect(b).toBeGreaterThan(a);
  });
});
