import { CRE_BREAKDOWN_DAY_SQL, CRE_FIRST_DAY, CRE_LANE_DAY_SQL, creKeySet, creRetagDaySql, NO_TOKEN_GROUPS, rollupDay } from '@ccip-dev/core';
import { NETWORKS } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { retagCre } from '../src/cre-retag';
import { LATE_FINALIZE_HOUR_UTC } from '../src/schedule';
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

const BSC = NETWORKS.bsc.chainSelector;
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
    expect(await meta('cre_retag_schema')).toBe('2');
    expect(await meta('cre_retag')).toBeNull();
    const lanes = (await env.DB.prepare("SELECT key, messages FROM daily_breakdown WHERE dim = 'cre_lane' AND day = '2026-11-04'").all()).results;
    expect(lanes).toEqual([{ key: `${BASE}>${BSC}`, messages: 1 }]);
    const day = (await env.DB.prepare("SELECT cre_messages, cre_usd FROM daily_totals WHERE day = '2026-11-04'").first());
    expect(day).toEqual({ cre_messages: 1, cre_usd: 9 });
    const rows = (await env.DB.prepare("SELECT key, messages FROM daily_breakdown WHERE dim = 'cre' AND day = '2026-11-04'").all()).results;
    expect(rows).toEqual([{ key: `${BASE}:${SENDER}`, messages: 1 }]);
  });

  it('runs a full pass when the re-tag schema changed, even with the key version done', async () => {
    // #given v1 done under schema 1, and a day 40 days back
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    await store.setMeta(env.DB, 'cre_retag_schema', '1');
    await seed('2026-09-26', true);
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when the runs walk back until the pass ends
    for (let run = 0; run < 20 && (await meta('cre_retag_schema')) !== '2'; run++) await retagCre(c);
    // #then the old day is re-tagged and both versions are recorded
    expect((await flags()).find((r: any) => r.message_id === '2026-09-26-cre')).toEqual({ message_id: '2026-09-26-cre', cre: 1 });
    expect(await meta('cre_keys_version')).toBe('v1');
    expect(await meta('cre_retag_schema')).toBe('2');
    expect(await meta('cre_retag')).toBeNull();
  });

  it('runs a full pass when the key version is done and no schema was ever recorded', async () => {
    // #given production after the first pass finished, before schema versions existed
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when
    await retagCre(c, 1);
    // #then
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v1#2', next: '2026-11-04', from: CRE_FIRST_DAY });
  });

  it('restarts a pass stored under the old version format as a full pass', async () => {
    // #given production's in-progress first pass, stored before schema versions existed
    await store.setMeta(env.DB, 'cre_retag', JSON.stringify({ version: 'v1', next: '2026-10-07', from: CRE_FIRST_DAY }));
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when
    await retagCre(c, 3);
    // #then it starts again from today under v1#2 and covers the whole history
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v1#2', next: '2026-11-02', from: CRE_FIRST_DAY });
  });

  it('a key change alone still re-tags only the last 30 days', async () => {
    // #given v1 done under the current schema
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    await store.setMeta(env.DB, 'cre_retag_schema', '2');
    const { c } = harness({ now: NOW, creKeys: keys('v2') });
    // #when
    await retagCre(c, 1);
    // #then
    expect(JSON.parse((await meta('cre_retag'))!).from).toBe('2026-10-07');
  });

  it('walks at most maxDays a run and keeps its place in cre_retag', async () => {
    // #given
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when
    await retagCre(c, 3);
    // #then
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v1#2', next: '2026-11-02', from: CRE_FIRST_DAY });
  });

  it('re-tags only the last 30 days after a key change', async () => {
    // #given v1 done, and a day 40 days back whose flag v1 never set
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    await store.setMeta(env.DB, 'cre_retag_schema', '2');
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
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v2#2', next: '2026-11-02', from: CRE_FIRST_DAY });
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
    await store.setMeta(env.DB, 'cre_retag_schema', '2');
    const { c } = harness({ now: NOW, creKeys: keys('v2') });
    // #when the 30-day re-tag reaches 2026-10-15
    await retagCre(c);
    await retagCre(c);
    // #then
    expect(await meta(store.ROLLED_THROUGH_KEY)).toBe('2026-09');
  });

  it('leaves a rolled month alone when the re-tagged day holds no CRE message', async () => {
    // #given October is rolled, and its day holds only a message no key signed
    await store.upsertListRows(env.DB, [liveRow({ id: 'plain', sendTs: '2026-10-15T10:00:00.000Z', sender: SENDER }, { origin: SENDER })], []);
    await store.replaceDaily(env.DB, { day: '2026-10-15', ...TOTALS }, [], NOW);
    await store.setMeta(env.DB, store.ROLLED_THROUGH_KEY, '2026-10');
    await store.setMeta(env.DB, 'cre_keys_version', 'v1');
    await store.setMeta(env.DB, 'cre_retag_schema', '2');
    const { c } = harness({ now: NOW, creKeys: keys('v2') });
    // #when the 30-day re-tag reaches 2026-10-15
    await retagCre(c);
    await retagCre(c);
    // #then
    expect(await meta(store.ROLLED_THROUGH_KEY)).toBe('2026-10');
  });

  it.each(['00:30', `0${LATE_FINALIZE_HOUR_UTC}:00`])('does nothing at %s UTC, when a finalize rewrites days', async (time) => {
    // #given
    const { c } = harness({ now: `2026-11-05T${time}:00.000Z`, creKeys: keys('v1') });
    // #when
    await retagCre(c);
    // #then
    expect(await meta('cre_retag')).toBeNull();
  });

  it('runs at an hour a finalize does not use', async () => {
    // #given
    const { c } = harness({ now: '2026-11-05T05:59:00.000Z', creKeys: keys('v1') });
    // #when
    await retagCre(c, 1);
    // #then
    expect(JSON.parse((await meta('cre_retag'))!).next).toBe('2026-11-04');
  });

  it.each(['not json {', 'null', '42'])('starts a fresh pass over a stored cre_retag of %s', async (stored) => {
    // #given
    await store.setMeta(env.DB, 'cre_retag', stored);
    const { c } = harness({ now: NOW, creKeys: keys('v1') });
    // #when
    await retagCre(c, 3);
    // #then
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v1#2', next: '2026-11-02', from: CRE_FIRST_DAY });
  });

  it('keeps the days it finished when a later day fails', async () => {
    // #given a database whose re-tag of 2026-11-04 throws
    const failing = new Proxy(env.DB, {
      get(target, prop) {
        if (prop !== 'prepare') {
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.startsWith('UPDATE messages SET cre')) return statement;
          return new Proxy(statement, {
            get(s, key) {
              if (key !== 'bind') return Reflect.get(s, key, s);
              return (...args: unknown[]) => {
                if (args[0] === '2026-11-04') throw new Error('D1_ERROR: boom');
                return s.bind(...args);
              };
            },
          });
        };
      },
    });
    const { c } = harness({ now: NOW, creKeys: keys('v1'), db: failing });
    // #when
    await expect(retagCre(c)).rejects.toThrow('boom');
    // #then 2026-11-05 is done and the next run resumes at 2026-11-04
    expect(JSON.parse((await meta('cre_retag'))!)).toEqual({ version: 'v1#2', next: '2026-11-04', from: CRE_FIRST_DAY });
  });

  it('searches one day of messages through the day index', async () => {
    // #when
    const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${creRetagDaySql(keys('v1'))}`).bind('2026-11-04').all()).results;
    // #then
    expect(JSON.stringify(plan)).toMatch(/USING INDEX messages_day/);
  });

  it("indexes a day's cre rows through messages_day", async () => {
    // #when
    const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${CRE_BREAKDOWN_DAY_SQL}`).bind('2026-11-04').all()).results;
    // #then
    expect(JSON.stringify(plan)).toMatch(/USING INDEX messages_day/);
  });

  it("indexes a day's cre lane rows through messages_day", async () => {
    // #when
    const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${CRE_LANE_DAY_SQL}`).bind('2026-11-04').all()).results;
    // #then
    expect(JSON.stringify(plan)).toMatch(/USING INDEX messages_day/);
  });

  it("finds a day's cre rows for the conditional unroll with an index seek on day and dim, never a scan", async () => {
    // #when
    const plan = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${store.UNROLL_IF_CRE_SQL}`).bind('2026-09', '2026-10', store.ROLLED_THROUGH_KEY, '2026-10-15').all()).results;
    // #then
    expect(JSON.stringify(plan)).toMatch(/SEARCH daily_breakdown USING COVERING INDEX \w+ \((day=\? AND dim=\?|dim=\? AND day=\?)\)/);
  });
});

describe('finalize and retag agree', () => {
  it("write the same CRE totals and cre rows for a day, fee-less senders included", async () => {
    // #given a day with one CRE sender whose fees are all unpriced, one with mixed fees, and a message no key signed
    const DAY = '2026-10-20';
    const MIXED = '0x00000000000000000000000000000000000d0002';
    await store.upsertListRows(env.DB, [
      liveRow({ id: 'a1', sendTs: `${DAY}T10:00:00.000Z`, sender: SENDER }, { origin: NODE, cre: 1, usd_value: 4, fee_usd: null }),
      liveRow({ id: 'a2', sendTs: `${DAY}T10:01:00.000Z`, sender: SENDER }, { origin: NODE, cre: 1, usd_value: 0, fee_usd: null }),
      liveRow({ id: 'b1', sendTs: `${DAY}T10:02:00.000Z`, sender: MIXED }, { origin: NODE, cre: 1, usd_value: 7, fee_usd: 1.5 }),
      liveRow({ id: 'b2', sendTs: `${DAY}T10:03:00.000Z`, sender: MIXED }, { origin: NODE, cre: 1, usd_value: 1, fee_usd: null }),
      liveRow({ id: 'p1', sendTs: `${DAY}T10:04:00.000Z`, sender: MIXED }, { origin: MIXED, usd_value: 50, fee_usd: 2 }),
    ], []);
    const { totals, breakdown } = rollupDay(DAY, await store.messagesForDay(env.DB, DAY), [], NO_TOKEN_GROUPS);
    await store.replaceDaily(env.DB, totals, breakdown, NOW);
    const snapshot = async () => ({
      totals: await env.DB.prepare('SELECT cre_messages, cre_usd FROM daily_totals WHERE day = ?').bind(DAY).first(),
      rows: (await env.DB.prepare("SELECT key, messages, usd_value, fee_usd FROM daily_breakdown WHERE day = ? AND dim = 'cre' ORDER BY key").bind(DAY).all()).results,
    });
    const creLanes = async (day: string) =>
      (await env.DB.prepare("SELECT key, messages, usd_value, fee_usd FROM daily_breakdown WHERE dim = 'cre_lane' AND day = ? ORDER BY key").bind(day).all()).results;
    const finalized = await snapshot();
    const lanesBefore = await creLanes(DAY);
    // #when
    await store.retagCreDay(env.DB, DAY, creRetagDaySql(keys('v1')), 'cre_retag', 'test');
    // #then
    expect(finalized.totals).toEqual({ cre_messages: 4, cre_usd: 12 });
    expect(await snapshot()).toEqual(finalized);
    expect(await creLanes(DAY)).toEqual(lanesBefore);
    expect(lanesBefore.length).toBeGreaterThan(0);
  });
});
