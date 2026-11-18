import { PegFileSchema } from '@ccip-dev/core/public';
import { fakeFetch, jsonResponse, pegAmountWord, PEG_WORD, pegRpc } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runPeg } from '../src/jobs/peg';
import * as pegStore from '../src/peg-store';
import { harness, readPublic, resetStorage } from './helpers';

beforeEach(resetStorage);

const ENV = { RPC_ETHEREUM: 'https://rpc.one', RPC_FALLBACKS: '', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALERT_CHAT_ID: '42' };
const at = (minute: number) => new Date(Date.UTC(2026, 10, 18, 0, minute)).toISOString();

/** Runs one check at `minute` with stLINK at `spot` LINK; returns the alert-chat messages it sent. */
async function check(minute: number, spot: number): Promise<string[]> {
  const sent: string[] = [];
  const telegram = (url: string, init?: RequestInit) => {
    if (!url.startsWith('https://api.telegram.org/')) return undefined;
    sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return jsonResponse({ ok: true });
  };
  await runPeg(harness({ now: at(minute), fetch: fakeFetch(telegram, pegRpc({ [PEG_WORD.spot]: pegAmountWord(spot) })), env: ENV }).c);
  return sent;
}

const heads = (msgs: string[]) => msgs.map((m) => m.split('\n')[0]);

describe('episodes from the 5-minute checks', () => {
  it('opens on the second sample, goes public and tiers, closes, and keeps one row', async () => {
    expect(await check(0, 0.995)).toEqual([]);
    expect(heads(await check(5, 0.9948))).toEqual(['stLINK at a 0.52% discount (1 stLINK = 0.9948 LINK)']);
    expect(await check(10, 0.99)).toEqual([]);
    expect(heads(await check(15, 0.99))).toEqual(['stLINK discount past the 0.75% public line: now 1.00%. Public posts are off.', 'stLINK discount past 1%: now 1.00% (1 stLINK = 0.9900 LINK)']);
    await check(20, 0.9995);
    expect(heads(await check(25, 0.9995))).toEqual(['stLINK discount closed after 25m 0s: peak 1.00% at Nov 18 00:10 UTC']);
    const rows = await pegStore.recentPegEpisodes(env.DB, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ side: 'discount', opened_at: at(0), closed_at: at(25), tier: 1, public: 1, public_at: at(15) });
  });

  it('publishes the open episode in peg.json while it runs', async () => {
    await check(0, 0.995);
    await check(5, 0.995);
    const peg = PegFileSchema.parse(await readPublic('peg.json'));
    expect(peg.episode).toMatchObject({ side: 'discount', opened_at: at(0), closed_at: null, public: false });
    expect(peg.recent_episodes).toHaveLength(1);
  });

  it('does not count a sample older than 15 minutes as the previous one', async () => {
    await check(0, 0.995);
    expect(await check(20, 0.995)).toEqual([]);
    expect(heads(await check(25, 0.995))).toEqual(['stLINK at a 0.50% discount (1 stLINK = 0.9950 LINK)']);
  });

  it('closes a discount and opens a premium in one run when the price flips', async () => {
    await check(0, 0.995);
    await check(5, 0.995);
    await check(10, 1.004);
    expect(heads(await check(15, 1.004))).toEqual(['stLINK discount closed after 15m 0s: peak 0.50% at Nov 18 00:00 UTC', 'stLINK at a 0.40% premium (1 stLINK = 1.0040 LINK)']);
    const rows = await pegStore.recentPegEpisodes(env.DB, 10);
    expect(rows.map((r) => [r.side, r.closed_at])).toEqual([['premium', null], ['discount', at(15)]]);
  });

  it('keeps the largest Curve depth seen as the best size', async () => {
    await check(0, 0.995);
    await check(5, 0.995);
    expect((await pegStore.openPegEpisode(env.DB))?.best_size).toBe(10_000);
  });
});
