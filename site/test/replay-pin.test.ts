import { createHash } from 'node:crypto';
import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { Show } from '../src/replay/director/show';
import { scoreFor } from '../src/replay/score/schedule';
import { drawStory } from '../src/replay/story/draw';
import { layoutFor } from '../src/replay/story/layout';
import { chainNameMap } from '../src/lib/names';
import { buildLayout } from '../src/sky/layout';
import { CHAINS, monthsHistory, monthsReplay } from './fixtures/months';
import replayJson from './fixtures/replay.json';

/**
 * Pins the all-time replay as it was before the month cut: every frame the director makes, every call the story layer
 * draws and every note of the score, for the default cut and a focus cut. A change to any of them changes a digest.
 */
const round = (_key: string, value: unknown) => (typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, round)).digest('hex').slice(0, 16);

const small = replayJson as ReplayFile;
const smallHistory: DayTotals[] = small.days.map((d, i) => ({
  day: d.day, messages: [2, 35, 15, 8][i]!, token_messages: 0, usd_value: [0, 1500, 1_502_000, 1000][i]!, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null,
}));
const months = monthsReplay();
const monthsDays = monthsHistory(months);

function allTime(replay: ReplayFile, history: DayTotals[], length: number, focus: string | null = null): Show {
  return new Show({ replay, history, stars: buildLayout(replay.chains), length, focus, eligible: () => true });
}

interface Pinned {
  make: () => Show;
  replay: ReplayFile;
  frames: string;
  calls: string;
  score: string;
}

const SHOWS: [string, Pinned][] = [
  ['small, 30 s', { make: () => allTime(small, smallHistory, 30), replay: small, frames: '63bbeaed5460a86b', calls: '87211383fb15b611', score: 'f846779fe55bdc71' }],
  ['ten weeks, 15 s', { make: () => allTime(months, monthsDays, 15), replay: months, frames: 'ff33bef118858d2e', calls: '73c21c0253a2ce37', score: '5d5f8419f52fadde' }],
  ['ten weeks, 30 s', { make: () => allTime(months, monthsDays, 30), replay: months, frames: 'b87efc300486cdfa', calls: 'c846c27192cbb0ef', score: 'b06b7b7355ebf58e' }],
  ['ten weeks, 60 s', { make: () => allTime(months, monthsDays, 60), replay: months, frames: '8ed82c0ece5d3751', calls: '3314bee3c99c8120', score: '78d3ea6d2f8efaa5' }],
  [
    'ten weeks, Arbitrum, 30 s',
    { make: () => allTime(months, monthsDays, 30, CHAINS[2]!.selector), replay: months, frames: 'b0d557440007655a', calls: '66c8c55b1c796008', score: 'a1801e455ef93098' },
  ],
];

function frames(show: Show): unknown[] {
  return Array.from({ length: show.length * 8 + 1 }, (_, i) => show.frameAt(i / 8));
}

function recordingCtx(log: unknown[]): CanvasRenderingContext2D {
  const plain = (v: unknown) => (typeof v === 'object' && v !== null ? 'object' : v);
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') {
          return (...args: unknown[]) => {
            log.push([key, ...args]);
            return { addColorStop: (...stop: unknown[]) => log.push(['addColorStop', ...stop]) };
          };
        }
        return (...args: unknown[]) => log.push([String(key), ...args.map(plain)]);
      },
      set: (_target, key, value) => {
        log.push(['set', String(key), plain(value)]);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

function drawCalls(show: Show, replay: ReplayFile): unknown[] {
  const log: unknown[] = [];
  const assets = { names: chainNameMap(replay.chains), coins: new Map<string, CanvasImageSource>(), ticks: show.yearTicks().map((y) => ({ at: y.time / show.length, label: y.label })) };
  for (const [w, h] of [[1920, 1080], [1080, 1080], [1080, 1920]] as const) {
    for (let i = 0; i <= show.length * 4; i++) drawStory(recordingCtx(log), show.frameAt(i / 4), layoutFor(w, h), assets);
  }
  return log;
}

describe('the all-time replay is unchanged by the month cut', () => {
  it.each(SHOWS)('makes the same frames (%s)', (_name, pin) => {
    expect(digest(frames(pin.make()))).toBe(pin.frames);
  });

  it.each(SHOWS)('draws the same story layer (%s)', (_name, pin) => {
    expect(digest(drawCalls(pin.make(), pin.replay))).toBe(pin.calls);
  });

  it.each(SHOWS)('plays the same score (%s)', (_name, pin) => {
    expect(digest(scoreFor(pin.make()))).toBe(pin.score);
  });
});
