import { PEG_HISTORY_START, PEG_PAGE_S } from '@ccip-dev/core';
import { PegHistoryFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PEG_PAGES_PER_RUN, PEG_REFRESH_S, runPegHistory } from '../src/jobs/peg-history';
import * as pegStore from '../src/peg-store';
import * as store from '../src/store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);
afterEach(() => vi.restoreAllMocks());

const START_S = Date.parse(PEG_HISTORY_START) / 1000;

/** Answers every page with one bar at the page's last whole hour, priced `close`, or with `data: []`. */
function curve(opts: { close?: number; empty?: boolean; down?: boolean } = {}) {
  return fakeFetch((url) => {
    if (!url.startsWith('https://prices.curve.finance/')) return undefined;
    if (opts.down) return jsonResponse({}, 503);
    const end = Number(new URL(url).searchParams.get('end'));
    const time = end - (end % 3_600);
    const close = opts.close ?? 0.999;
    return jsonResponse({ data: opts.empty ? [] : [{ time, open: close, high: close, low: close, close }] });
  });
}

const pages = (f: { calls: { url: string }[] }) => f.calls.map((c) => new URL(c.url).searchParams).map((q) => [Number(q.get('start')), Number(q.get('end'))]);

describe('runPegHistory', () => {
  it('backfills to the first hour in one run when it is close, then only refreshes', async () => {
    const now = '2025-05-20T00:00:00.000Z';
    const f = curve();
    await runPegHistory(harness({ now, fetch: f }).c);
    const nowS = Date.parse(now) / 1000;
    expect(pages(f)).toEqual([
      [nowS - PEG_REFRESH_S, nowS],
      [nowS - PEG_PAGE_S, nowS],
      [nowS - 2 * PEG_PAGE_S, nowS - PEG_PAGE_S],
      [nowS - 3 * PEG_PAGE_S, nowS - 2 * PEG_PAGE_S],
      [START_S, nowS - 3 * PEG_PAGE_S],
    ]);
    expect(await store.getMeta(env.DB, 'peg_backfill_done')).toBe('1');

    const again = curve();
    await runPegHistory(harness({ now, fetch: again }).c);
    expect(pages(again)).toEqual([[nowS - PEG_REFRESH_S, nowS]]);
  });

  it(`takes at most ${PEG_PAGES_PER_RUN} pages a run and resumes from its cursor`, async () => {
    const now = '2025-07-28T00:00:00.000Z';
    const first = curve();
    await runPegHistory(harness({ now, fetch: first }).c);
    expect(first.calls).toHaveLength(PEG_PAGES_PER_RUN + 1);
    expect(await store.getMeta(env.DB, 'peg_backfill_done')).toBeNull();
    const second = curve();
    await runPegHistory(harness({ now, fetch: second }).c);
    expect(await store.getMeta(env.DB, 'peg_backfill_done')).toBe('1');
    expect(pages(second)[1]![1]).toBe(Date.parse(now) / 1000 - PEG_PAGES_PER_RUN * PEG_PAGE_S);
  });

  it('advances through empty pages and publishes nothing until there are bars', async () => {
    await runPegHistory(harness({ now: '2025-05-20T00:00:00.000Z', fetch: curve({ empty: true }) }).c);
    expect(await store.getMeta(env.DB, 'peg_backfill_done')).toBe('1');
    expect(await env.PUBLIC.get('v1/peg-history.json')).toBeNull();
  });

  it('replaces a corrected recent hour on refresh', async () => {
    const now = '2025-05-20T00:00:00.000Z';
    await runPegHistory(harness({ now, fetch: curve({ close: 0.99 }) }).c);
    await runPegHistory(harness({ now, fetch: curve({ close: 0.995 }) }).c);
    expect((await pegStore.pegHours(env.DB)).at(-1)!.close).toBe(0.995);
  });

  it('publishes peg-history.json with the configured thresholds', async () => {
    await runPegHistory(harness({ now: '2025-05-20T00:00:00.000Z', fetch: curve(), env: { PEG_ALERT_PRIVATE_PCT: '0.4', PEG_ALERT_PUBLIC_PCT: '1' } }).c);
    const file = PegHistoryFileSchema.parse(await readPublic('peg-history.json'));
    expect(file.thresholds).toEqual({ private: 0.004, public: 0.01 });
    expect(file.attribution).toMatch(/Curve/);
    expect(file.days.length).toBeGreaterThan(0);
  });

  it('refreshes the recent hours even when the backfill pages keep failing', async () => {
    const now = '2025-05-20T00:00:00.000Z';
    const nowS = Date.parse(now) / 1000;
    const refreshOnly = fakeFetch((url) => {
      if (!url.startsWith('https://prices.curve.finance/')) return undefined;
      const q = new URL(url).searchParams;
      if (Number(q.get('start')) !== nowS - PEG_REFRESH_S) return jsonResponse({}, 500);
      return jsonResponse({ data: [{ time: nowS - 3_600, open: 0.99, high: 0.99, low: 0.99, close: 0.99 }] });
    });
    await runPegHistory(harness({ now, fetch: refreshOnly }).c);
    expect((await pegStore.pegHours(env.DB)).map((b) => b.close)).toEqual([0.99]);
    expect(await store.getMeta(env.DB, 'peg_history_failures')).toBe('1');
  });

  it('alerts a failed marker scan at once under its own signature, and still publishes', async () => {
    vi.spyOn(pegStore, 'pegMarkerEvents').mockRejectedValue(new Error('scan broke'));
    const h = harness({ now: '2025-05-20T00:00:00.000Z', fetch: curve() });
    await runPegHistory(h.c);
    expect(h.alerts.map((a) => a.signature)).toEqual(['peg-markers']);
    expect(await store.getMeta(env.DB, 'peg_history_failures')).toBe('0');
    expect(await env.PUBLIC.get('v1/peg-history.json')).not.toBeNull();
  });

  it('alerts after six failed runs in a row and still publishes the bars it has', async () => {
    const now = '2025-05-20T00:00:00.000Z';
    await runPegHistory(harness({ now, fetch: curve() }).c);
    await env.PUBLIC.delete('v1/peg-history.json');
    const alerts: string[] = [];
    for (let run = 1; run <= 6; run++) {
      const h = harness({ now, fetch: curve({ down: true }) });
      await runPegHistory(h.c);
      alerts.push(...h.alerts.map((a) => a.signature));
      expect(alerts).toEqual(run < 6 ? [] : ['peg-history']);
    }
    expect(await env.PUBLIC.get('v1/peg-history.json')).not.toBeNull();
  });
});
