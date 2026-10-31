import { operatorMomentFacts, stakingWeekFacts } from '@ccip-dev/core/staking-broadcasts';
import { fakeFetch, STAKING_FIXTURE, STAKING_NEW_OPERATOR, STAKING_OPERATOR } from '@ccip-dev/core/testing';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { composeCopy, TELEGRAM_CAPTION_MAX, X_MAX } from '../src/broadcasts/copy';
import type { Broadcast, BroadcastOutput } from '../src/broadcasts/outputs';
import { OPERATOR_SINCE_KEY, runBroadcasts } from '../src/broadcasts/run';
import { xLength } from '../src/broadcasts/x-length';
import * as store from '../src/store';
import { harness, resetStorage } from './helpers';

beforeEach(resetStorage);

const JOINED = Date.parse('2026-11-01T09:00:00.000Z') / 1000;
const UNSTAKED = Date.parse('2026-10-27T12:00:00.000Z') / 1000;

function recorder(name: string) {
  const sent: Broadcast[] = [];
  const output: BroadcastOutput = { name, send: async (b) => (sent.push(b), 'sent') };
  return { output, sent };
}

const card = () => fakeFetch((url) => (url.startsWith('https://ccip.dev/og/') ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }) : undefined));

async function stakingRun(now: string, staking = STAKING_FIXTURE) {
  const channel = recorder('telegram-channel');
  const x = recorder('x-post');
  const h = harness({ now, fetch: card(), env: { BROADCASTS: 'on' } });
  await runBroadcasts(h.c, { kind: 'staking', staking }, { channel: [channel.output], xPost: [x.output], drafts: [], preview: [] });
  return { channel: channel.sent.map((b) => b.key), x: x.sent.map((b) => b.key), sent: channel.sent, alerts: h.alerts };
}

describe('the weekly staking report', () => {
  it('posts last week on Monday from 14:00 UTC, to the channel and X, once', async () => {
    await store.setMeta(env.DB, OPERATOR_SINCE_KEY, '2026-11-01T09:00:00.000Z');
    const early = await stakingRun('2026-11-02T13:00:00.000Z');
    const due = await stakingRun('2026-11-02T14:00:00.000Z');
    const again = await stakingRun('2026-11-02T15:00:00.000Z');
    expect({ early: early.channel, due: [due.channel, due.x], again: again.channel }).toEqual({
      early: [],
      due: [['broadcast:staking:2026-10-26'], ['broadcast:staking:2026-10-26']],
      again: [],
    });
    expect(due.sent[0]?.telegramHtml.startsWith('<b>Chainlink staking · week of Oct 26 – Nov 1</b>')).toBe(true);
  });

  it('retries through Tuesday, and not on other days', async () => {
    await store.setMeta(env.DB, OPERATOR_SINCE_KEY, '2026-11-01T09:00:00.000Z');
    const wednesday = await stakingRun('2026-11-04T14:00:00.000Z');
    const tuesday = await stakingRun('2026-11-03T02:00:00.000Z');
    expect({ wednesday: wednesday.channel, tuesday: tuesday.channel }).toEqual({ wednesday: [], tuesday: ['broadcast:staking:2026-10-26'] });
  });
});

describe('operator watch', () => {
  it('only sets the watermark on its first run, then posts newer joins, removals and unstakes', async () => {
    const first = await stakingRun('2026-11-01T12:00:00.000Z');
    expect({ sent: first.channel, since: await store.getMeta(env.DB, OPERATOR_SINCE_KEY) }).toEqual({ sent: [], since: '2026-11-01T09:00:00.000Z' });
    await store.setMeta(env.DB, OPERATOR_SINCE_KEY, '2026-10-26T00:00:00.000Z');
    const next = await stakingRun('2026-10-29T12:00:00.000Z', { ...STAKING_FIXTURE, operator_events: STAKING_FIXTURE.operator_events.slice(1) });
    expect(next.x).toEqual([`broadcast:operator:${STAKING_OPERATOR}:${UNSTAKED}`]);
  });

  it('never posts an event more than 3 days old', async () => {
    await store.setMeta(env.DB, OPERATOR_SINCE_KEY, '2026-10-26T00:00:00.000Z');
    const late = await stakingRun('2026-11-01T12:00:00.000Z');
    expect(late.channel).toEqual([`broadcast:operator:${STAKING_NEW_OPERATOR}:${JOINED}`]);
  });
});

describe('staking copy', () => {
  it('fits X and Telegram, with one cashtag on X', () => {
    const week = composeCopy({ kind: 'staking', week: stakingWeekFacts(STAKING_FIXTURE, '2026-10-26')! });
    const joined = composeCopy({ kind: 'operator', moment: operatorMomentFacts(STAKING_FIXTURE, STAKING_NEW_OPERATOR, JOINED)! });
    const unstaked = composeCopy({ kind: 'operator', moment: operatorMomentFacts(STAKING_FIXTURE, STAKING_OPERATOR, UNSTAKED)! });
    for (const c of [week, joined, unstaked]) {
      expect(xLength(c.xText)).toBeLessThanOrEqual(X_MAX);
      expect(c.telegramHtml.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_MAX);
      expect(c.xText.match(/\$LINK/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
    expect(week.xText.split('\n').slice(0, 3)).toEqual([
      'Chainlink staking, week of Oct 26 – Nov 1',
      'Community pool full for 1,060 days: 40.9M $LINK · 8,528 stakers',
      'In 120.0K · out 110.0K LINK · 12 new stakers',
    ]);
    expect(joined.xText.split('\n')[0]).toBe('New in the Chainlink staking operator pool: Deepbase');
    expect(unstaked.telegramHtml.split('\n').slice(0, 3)).toEqual([
      '<b>Operator watch</b>',
      'Node operator LinkPool unstaked 7,221 LINK from Chainlink staking, through a stake.link vault',
      'It still stakes 67,779 LINK',
    ]);
  });
});
