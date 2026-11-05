// worker/test/cre-retag.test.ts
import { CRE_FIRST_DAY, creKeySet, creRetagDaySql } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { retagCre } from '../src/cre-retag';
import * as store from '../src/store';
import { harness, liveRow, resetStorage } from './helpers';

beforeEach(resetStorage);

const BASE = NETWORKS.base.chainSelector;
const NODE = '0x00000000000000000000000000000000000c4e01';
const SENDER = '0x00000000000000000000000000000000000d0001';
const keys = (version: string) => creKeySet({ version, keys: [`${BASE}:${NODE}`] });
const TOTALS = { messages: 2, token_messages: 0, data_messages: 2, usd_value: 9, fee_usd: null, unique_senders: 1, median_delivery_s: null, unpriced_messages: 0 };
const NOW = '2026-11-05T01:00:00.000Z';

async function seed(day: string, rolledUp: boolean): Promise<void> {
  await store.upsertListRows(env.DB, [
    liveRow({ id: `${day}-cre`, sendTs: `${day}T10:00:00.000Z`, sender: SENDER }, { origin: NODE, usd_value: 9 }),
    liveRow({ id: `${day}-other`, sendTs: `${day}T11:00:00.000Z`, sender: SENDER }, { origin: SENDER }),
  ], []);
  if (rolledUp) await store.replaceDaily(env.DB, { day, ...TOTALS }, [], NOW);
}

const flags = async () => (await env.DB.prepare('SELECT message_id, cre FROM messages ORDER BY message_id').all()).results;
const meta = (key: string) => store.getMeta(env.DB, key);

describe('retagCre', () => {
  it('back-tags every day from today to CRE_FIRST_DAY on the first pass, 30 days a run, then records the version', async () => {
    // #given a rolled-up day at each end of the history
    await seed('2026-11-04', true);
    await seed(CRE_FIRST_DAY, true);
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when the runs walk back until the pass ends
    for (let run = 0; run < 20 && (await meta('cre_keys_version')) === null; run++) await retagCre(c);
    // #then
    expect(await flags()).toEqual([
      { message_id: `${CRE_FIRST_DAY}-cre`, cre: 1 }, { message_id: `${CRE_FIRST_DAY}-other`, cre: 0 },
      { message_id: '2026-11-04-cre', cre: 1 }, { message_id: '2026-11-04-other', cre: 0 },
    ]);
    expect(await meta('cre_keys_version')).toBe('v1');
    expect(await meta('cre_retag')).toBeNull();
    const day = (await env.DB.prepare("SELECT cre_messages, cre_usd FROM daily_totals WHERE day = '2026-11-04'").first());
    expect(day).toEqual({ cre_messages: 1, cre_usd: 9 });
    const rows = (await env.DB.prepare("SELECT key, messages FROM daily_breakdown WHERE dim = 'cre' AND day = '2026-11-04'").all()).results;
    expect(rows).toEqual([{ key: `${BASE}:${SENDER}`, messages: 1 }]);
  });

  it('walks at most maxDays a run and keeps its place in cre_retag', async () => {
    // #given
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when
    await retagCre(c, 3);
    // #then
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v1', next: '2026-11-02', from: CRE_FIRST_DAY });
  });

  it('re-tags only the last 30 days after a key change', async () => {
    // #given v1 done, and a day 40 days back whose flag v1 never set
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    await seed('2026-09-26', true);
    await seed('2026-11-01', true);
    const { c } = harness({ now: NOW, creKeys: keys('v2') });
    // #when
    await retagCre(c);
    await retagCre(c);
    // #then
    expect(await meta('cre_keys_version')).toBe('v2');
    const tagged = (await flags()).filter((r: any) => r.cre === 1).map((r: any) => r.message_id);
    expect(tagged).toEqual(['2026-11-01-cre']);
  });

  it('restarts from today when the version changes mid-pass, and never marks the old version done', async () => {
    // #given a v1 first pass part-way through
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    await retagCre(c, 3);
    // #when v2 arrives
    const next = harness({ now: NOW, creKeys: keys('v2') }).c;
    await retagCre(next, 3);
    // #then
    expect(await meta('cre_keys_version')).toBeNull();
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v2', next: '2026-11-02', from: CRE_FIRST_DAY });
  });

  it('tags a day not rolled up yet but writes no cre rows for it: finalize does', async () => {
    // #given today, with no daily_totals row
    await seed('2026-11-05', false);
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when
    await retagCre(c, 1);
    // #then
    expect((await flags()).find((r: any) => r.message_id === '2026-11-05-cre')).toEqual({ message_id: '2026-11-05-cre', cre: 1 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM daily_breakdown WHERE dim = 'cre'").first())).toEqual({ n: 0 });
  });

  it('does nothing with an empty key set', async () => {
    // #given
    const { c } = harness({ now: NOW });
    // #when
    await retagCre(c);
    // #then
    expect(await meta('cre_retag')).toBeNull();
    expect(await meta('cre_keys_version')).toBeNull();
  });

  it('moves the rolled pointer back so the monthly rollup redoes a touched month', async () => {
    // #given October is rolled
    await seed('2026-10-15', true);
    await store.setMeta(env.DB, store.ROLLED_THROUGH_KEY, '2026-10');
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    const { c } = harness({ now: NOW, creKeys: keys('v2') });
    // #when the 30-day re-tag reaches 2026-10-15
    await retagCre(c);
    await retagCre(c);
    // #then
    expect(await meta(store.ROLLED_THROUGH_KEY)).toBe('2026-09');
  });

  it('searches one day of messages through the day index', async () => {
    // #when
    const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${creRetagDaySql(keys('v1'))}`).bind('2026-11-04').all()).results;
    // #then
    expect(JSON.stringify(plan)).toMatch(/USING INDEX messages_day/);
  });
});
