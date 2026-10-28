import type { LiveMessage, ReserveFile, TodayFile } from '@ccip-dev/core/public';
import { ROSTER_FIXTURE } from '@ccip-dev/core/testing';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { milestoneGoal } from '../src/lib/all-time';
import { crossingText } from '../src/components/home/Celebration';
import { rowClass } from '../src/components/home/Feed';
import HomeTicker, { TICKER_MIN_ITEMS } from '../src/components/home/HomeTicker';
import { CorpsBody, newestMarine } from '../src/components/home/HomeCorps';
import HomeVault, { countdownParts } from '../src/components/home/HomeVault';
import Hud, { progressText, zuluText } from '../src/components/home/Hud';
import Milestones, { hexCells } from '../src/components/home/Milestones';
import Odometer from '../src/components/home/Odometer';
import { watchTime } from '../src/components/home/OnWatch';
import TodayTiles from '../src/components/home/TodayTiles';
import { chainNameMap } from '../src/lib/names';
import { CHAINS, ETH, BASE } from './fixtures/broadcast';
import reserveJson from './fixtures/reserve.json';
import todayJson from './fixtures/today.json';

const today = todayJson as unknown as TodayFile;
const reserve = reserveJson as unknown as ReserveFile;
/** The text without tags or React's comment markers, entities decoded. */
const text = (out: string) => out.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const render = <P extends object>(c: (p: P) => unknown, p: P) => renderToString(createElement(c as never, p as never));

describe('Odometer', () => {
  it('rolls each digit on a wheel and reads the value out once', () => {
    const out = render(Odometer, { text: '$1,204', label: '$1,204 moved' });
    expect(out.match(/class="odo-digit"/g)).toHaveLength(4);
    expect(out).toContain('translateY(-20%)');
    expect(out).toMatch(/aria-hidden="true"/);
    expect(text(out)).toContain('$1,204 moved');
  });
});

describe('Hud', () => {
  const allTime = { messages: 1_616_023, usd: 24_998_682_985.4, fees: 2_158_815 };
  const props = { today, yesterday: { messages: 2_689, usd_value: 56.4e6, fee_usd: 1_211 }, allTime, since: '2023-07-06', goal: milestoneGoal('value', allTime.usd, 40.7e6), crossed: null, fees: { usd: 2.2e6, runRateUsd: 420_200, since: null }, animate: false };

  it('leads with the all-time value and messages', () => {
    const out = text(render(Hud, props));
    expect(out).toContain('$24,998,682,985 moved over CCIP');
    expect(out).toMatch(/moved over CCIP since Jul 6, 2023 ?ⓘ ?· 1,616,023 messages/);
  });

  it('counts down to the next milestone without rounding up to it', () => {
    const out = text(render(Hud, props));
    expect(out).toContain('Next milestone · $25B moved');
    expect(out).toContain('99.99%');
    expect(out).toContain('$1.3M to go');
  });

  it("keeps today's fees linked to the Reserve and the all-time fees to the fee records", () => {
    const out = render(Hud, props);
    expect(out).toMatch(/<a[^>]*href="\/reserve\/"[^>]*>.*\$105.*fees<\/a>/);
    expect(out).toMatch(/href="\/records\/#fees"/);
    expect(text(out)).toMatch(/All-time fees: \$2\.2M · \$420\.2K ?\/yr at the 30-day pace/);
  });

  it('turns gold and says so the day a milestone falls', () => {
    const out = render(Hud, { ...props, crossed: { metric: 'value', threshold: 25e9 } });
    expect(out).toContain('hud hud-gold');
    expect(out).toContain('odo odo-gold');
    expect(text(out)).toContain('Crossed $25B moved today');
  });

  it('writes the time as the SITREP card does', () => {
    expect(zuluText(Date.parse('2026-10-28T14:14:27Z'))).toBe('Wed 28 Oct · 14:14:27Z');
    expect(progressText(0.99995)).toBe('99.99%');
  });
});

describe('Milestones', () => {
  const goals = [milestoneGoal('value', 24.9993e9, 40.7e6), milestoneGoal('messages', 1_616_023, 2_310), milestoneGoal('fees', 2_158_815, 1_162)];
  const reserveGoal = { link: 6_382_287, previous: 6e6, next: 7e6, eta: '2026-12-19' };
  const last = { value: { threshold: 10e9, day: '2025-12-24' }, messages: { threshold: 1e6, day: '2026-02-10' } };

  it('shows each milestone, the way there, and where it started', () => {
    const out = text(render(Milestones, { goals, reserve: reserveGoal, last, crossed: null }));
    expect(out).toContain('Moved · all time Imminent $25B now $24.99B moved');
    expect(out).toContain('Messages · all time 61.6% 2M now 1,616,023 messages');
    expect(out).toContain('from $10B on Dec 24, 2025');
    expect(out).toContain('Chainlink Reserve 38.2% 7M LINK now 6,382,287 LINK');
    expect(out).toContain('from 6M LINK');
  });

  it('marks the milestone crossed today', () => {
    const out = text(render(Milestones, { goals: [milestoneGoal('value', 25.01e9, 40.7e6)], reserve: null, last, crossed: { metric: 'value', threshold: 25e9 } }));
    expect(out).toContain('Crossed $25B today $50B');
    expect(out).toContain('from $25B, crossed today');
  });

  it('fills the hex bar cell by cell', () => {
    expect(hexCells(0.5, 4)).toEqual(['on', 'on', 'off', 'off']);
    expect(hexCells(0.6, 4)).toEqual(['on', 'on', 40, 'off']);
  });
});

describe('TodayTiles', () => {
  it("puts today's figures in one strip, each with its methodology link", () => {
    const out = render(TodayTiles, { totals: today.totals, yesterdaySenders: 344 });
    expect(text(out)).toContain('Token transfers');
    expect(text(out)).toContain('of 207 messages');
    expect(text(out)).toContain('yesterday 344');
    expect(out.match(/href="\/methodology\/#what-is-counted"/g)).toHaveLength(5);
  });
});

describe('the COMMS feed', () => {
  const msg = (id: string, usd: number | null): LiveMessage => ({ id, send_ts: `2026-10-28T14:00:0${id}.000Z`, status: 'SUCCESS', src: ETH, dst: BASE, token: usd ? 'USDC' : null, usd, sender_label: null });

  it('marks $1M+ rows gold, $10K+ rows big, and new rows sliding in', () => {
    expect(rowClass(msg('1', 2e6), false)).toBe('gold');
    expect(rowClass(msg('1', 50_000), true)).toBe('big in');
    expect(rowClass(msg('1', 5), false)).toBeUndefined();
  });

  it('crawls the ticker with a hidden repeat once there are enough messages, and holds still below that', () => {
    const names = chainNameMap(CHAINS.chains);
    const many = Array.from({ length: TICKER_MIN_ITEMS }, (_, i) => msg(String(i), 10));
    const crawling = render(HomeTicker, { messages: many, names });
    expect(crawling).toContain('ticker-track crawl');
    expect(crawling.match(/class="tk"/g)).toHaveLength(TICKER_MIN_ITEMS * 2);
    const still = render(HomeTicker, { messages: many.slice(0, 2), names });
    expect(still).not.toContain('crawl');
    expect(text(render(HomeTicker, { messages: [], names }))).toContain('No messages in the last 15 minutes.');
  });

  it('times a watch in minutes, then hours', () => {
    expect(watchTime(249)).toBe('04:09');
    expect(watchTime(3_849)).toBe('1:04:09');
  });
});

describe('HomeVault', () => {
  const initial = { latest: reserve.latest, link_price_usd: reserve.link_price_usd, cost_basis: reserve.cost_basis, pace: reserve.pace, weekly: reserve.weekly };

  it('shows the Reserve, its cost basis, streak and next milestone', () => {
    const out = text(render(HomeVault, { initial, today: { messages: 207, usd: 1.8e6, fees: 105 } }));
    expect(out).toContain('6,122,201');
    expect(out).toContain('on its $68.0M cost');
    expect(out).toContain('61-week deposit streak');
    expect(out).toContain('7,000,000 ETA Dec 16, 2026');
    expect(out).toContain('207 CCIP messages sent');
  });

  it('splits the countdown into days, hours, minutes and seconds', () => {
    expect(countdownParts(((1 * 24 + 2) * 3600 + 3 * 60 + 4) * 1000)).toEqual([1, 2, 3, 4]);
    expect(countdownParts(-5)).toEqual([0, 0, 0, 0]);
  });
});

describe('the Corps', () => {
  const now = new Date('2026-10-13T12:00:00.000Z');

  it('waits for the roster, then tells the Marine counts', () => {
    expect(text(render(CorpsBody, { roster: null, failed: false, now, telegram: false }))).toContain('Loading the roster…');
    expect(text(render(CorpsBody, { roster: null, failed: true, now, telegram: false }))).toContain('The roster is out of reach right now.');
  });

  it('shows the open plank-owner seats, the newest recruit and the enlist call', () => {
    const out = render(CorpsBody, { roster: ROSTER_FIXTURE, failed: false, now, telegram: true });
    const newest = newestMarine(ROSTER_FIXTURE)!;
    expect(text(out)).toContain(`${100 - ROSTER_FIXTURE.marines.length} of 100 seats still open`);
    expect(out.match(/mr-seat-next/g)).toHaveLength(1);
    expect(text(out)).toContain(newest.callsign);
    expect(text(out)).toContain('Your callsign is waiting.');
  });
});

describe('Celebration', () => {
  it('spells a crossing out in full', () => {
    expect(crossingText('value', 25e9)).toBe('$25,000,000,000 moved over CCIP');
    expect(crossingText('messages', 2e6)).toBe('2,000,000 CCIP messages');
    expect(crossingText('fees', 2.5e6)).toBe('$2,500,000 in CCIP fees');
  });
});
