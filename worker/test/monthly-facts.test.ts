import type { MonthSummary } from '@ccip-dev/core/month';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMonthlyFacts } from '../src/broadcasts/monthly';
import { harness, resetStorage } from './helpers';

beforeEach(resetStorage);

const SUMMARY_KEY = 'videos/monthly/2026-09.json';
const SEPTEMBER: MonthSummary = {
  month: '2026-09',
  label: 'September 2026',
  messages: 4_050,
  usd: 93e6,
  fees: 510,
  linkSharePct: 40,
  records: [{ kind: 'messages', day: '2026-09-10', value: 150, previous: { day: '2026-08-30', value: 100 }, stoodDays: 11 }],
  joined: [{ selector: '3', name: 'BNB Chain' }],
  busiestLane: { key: '3>1', src: { selector: '3', name: 'BNB Chain' }, dst: { selector: '1', name: 'Ethereum' }, usd: 63e6 },
};

const load = () => loadMonthlyFacts(harness({ now: '2026-10-01T02:00:00.000Z' }).c, '2026-09');

describe('loadMonthlyFacts', () => {
  it('reads the month summary the workflow recorded with the video, as it was written', async () => {
    // #given
    await env.ARCHIVE.put(SUMMARY_KEY, JSON.stringify({ month: '2026-09', summary: SEPTEMBER }));
    // #when
    const facts = await load();
    // #then
    expect(facts).toEqual({ kind: 'monthly', month: '2026-09', summary: SEPTEMBER });
  });

  it.each([
    ['missing', null, `${SUMMARY_KEY} is not in the archive bucket`],
    ['not JSON', '{"month": "2026-09"', `${SUMMARY_KEY} is not JSON`],
    [
      'not a month summary',
      JSON.stringify({ month: '2026-09', summary: { ...SEPTEMBER, fees: '510' } }),
      `${SUMMARY_KEY} is not a month summary (summary.fees: Invalid input: expected number, received string)`,
    ],
    ['for another month', JSON.stringify({ month: '2026-08', summary: { ...SEPTEMBER, month: '2026-08' } }), `${SUMMARY_KEY} is for 2026-08, not 2026-09`],
  ])('names the problem with a summary that is %s', async (_case, text, problem) => {
    // #given
    if (text !== null) await env.ARCHIVE.put(SUMMARY_KEY, text);
    // #when
    const facts = await load();
    // #then
    expect(facts).toEqual({ problem });
  });
});
